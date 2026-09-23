// Cloudflare R2 (S3-compatible) — the cold half of image storage.
//
// Images older than the local retention window move here: cheap per GB, and R2
// charges nothing to read them back out, which matters because the whole point
// is that an archived image is still viewable on demand rather than parked
// somewhere that costs money every time someone scrolls back through a chat.
//
// Entirely inert until all four environment variables are set on the service.
// Nothing archives, nothing is deleted, and every read falls straight back to
// local disk — so this can ship and sit dormant until the bucket exists,
// instead of being switched on by a deploy nobody is watching.
const crypto = require('crypto');
const { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');

const ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const BUCKET = process.env.R2_BUCKET;
const ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;

function isConfigured() {
  return Boolean(ACCOUNT_ID && BUCKET && ACCESS_KEY_ID && SECRET_ACCESS_KEY);
}

let client = null;
function getClient() {
  if (!isConfigured()) return null;
  if (!client) {
    client = new S3Client({
      region: 'auto', // R2 has no regions; the SDK still requires the field
      endpoint: `https://${ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId: ACCESS_KEY_ID, secretAccessKey: SECRET_ACCESS_KEY },
    });
  }
  return client;
}

async function streamToBuffer(body) {
  const chunks = [];
  for await (const chunk of body) chunks.push(chunk);
  return Buffer.concat(chunks);
}

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

// Uploads, then reads back and compares a hash of what R2 actually returns
// against the bytes that went in.
//
// The read-back is the point: this is the step that runs immediately before a
// local file becomes eligible for deletion, so "the upload call didn't throw"
// is not a good enough basis to delete the only other copy. A truncated body,
// a silently retried multipart, the wrong key — all of those look like success
// from the writing side alone. Returns false rather than throwing so the
// caller's decision is always an explicit "verified or don't touch it".
async function putVerified(key, buffer, contentType) {
  const s3 = getClient();
  if (!s3) return false;
  await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: buffer, ContentType: contentType }));
  const check = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  const returned = await streamToBuffer(check.Body);
  return returned.length === buffer.length && sha256(returned) === sha256(buffer);
}

async function getObject(key) {
  const s3 = getClient();
  if (!s3) return null;
  try {
    const res = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
    return { buffer: await streamToBuffer(res.Body), contentType: res.ContentType || 'image/jpeg' };
  } catch (err) {
    // A missing object is an ordinary outcome for a caller that is checking
    // whether something was ever archived; a genuine fault is worth surfacing.
    if (err?.name === 'NoSuchKey' || err?.$metadata?.httpStatusCode === 404) return null;
    throw err;
  }
}

async function objectExists(key) {
  const s3 = getClient();
  if (!s3) return false;
  try {
    await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
    return true;
  } catch {
    return false;
  }
}

async function deleteObject(key) {
  const s3 = getClient();
  if (!s3) return;
  await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
}

module.exports = { isConfigured, putVerified, getObject, objectExists, deleteObject, sha256, streamToBuffer, BUCKET };
