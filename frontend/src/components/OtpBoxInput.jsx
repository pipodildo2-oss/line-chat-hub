import { useRef } from 'react';

// Six individual boxes for a numeric code (2FA TOTP entry) instead of one
// plain text field — used by Login.jsx's verify step and TwoFactorSetup.jsx's
// confirm step. Fully controlled: `value` is the digits typed so far (up to
// `length`), `onChange` receives the new full string on every edit.
//
// `forceDark`: same reasoning as TwoFactorSetup.jsx — Login.jsx is
// intentionally always-dark and never toggles with the rest of the app's
// color mode, so it needs fixed dark classes instead of `dark:` variants
// that could end up dormant there.
export default function OtpBoxInput({ value, onChange, length = 6, disabled, autoFocus, forceDark = false, onComplete }) {
  const inputRefs = useRef([]);

  function setDigit(index, char) {
    const next = value.padEnd(length, ' ').split('');
    next[index] = char;
    const joined = next.join('').replace(/ +$/, '').replace(/ /g, '');
    onChange(joined);
    return joined;
  }

  function focusBox(index) {
    inputRefs.current[index]?.focus();
    inputRefs.current[index]?.select();
  }

  function handleChange(index, e) {
    const raw = e.target.value.replace(/\D/g, '');
    if (!raw) {
      setDigit(index, '');
      return;
    }
    // A fast typist's keystroke can land more than one digit in a single
    // box on some mobile keyboards — spread them across this box and the
    // following ones instead of dropping all but the last.
    let joined = value;
    let landedAt = index;
    for (const digit of raw) {
      joined = setDigit(landedAt, digit);
      if (landedAt >= length - 1) break;
      landedAt++;
    }
    if (joined.length >= length) {
      onComplete?.(joined);
      inputRefs.current[length - 1]?.blur();
    } else {
      // `landedAt` already points at the next empty box: the loop above
      // advances it past every box it just wrote to, so re-adding 1 here
      // (an earlier version did) skipped a box after every single keystroke.
      focusBox(landedAt);
    }
  }

  function handleKeyDown(index, e) {
    if (e.key === 'Backspace') {
      if (value[index]) {
        setDigit(index, '');
      } else if (index > 0) {
        setDigit(index - 1, '');
        focusBox(index - 1);
      }
      e.preventDefault();
    } else if (e.key === 'ArrowLeft' && index > 0) {
      focusBox(index - 1);
      e.preventDefault();
    } else if (e.key === 'ArrowRight' && index < length - 1) {
      focusBox(index + 1);
      e.preventDefault();
    }
  }

  function handlePaste(index, e) {
    e.preventDefault();
    const digits = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, length - index);
    if (!digits) return;
    const next = value.padEnd(length, ' ').split('');
    for (let i = 0; i < digits.length; i++) next[index + i] = digits[i];
    const joined = next.join('').replace(/ +$/, '').replace(/ /g, '');
    onChange(joined);
    if (joined.length >= length) {
      onComplete?.(joined);
      inputRefs.current[length - 1]?.blur();
    } else {
      focusBox(Math.min(index + digits.length, length - 1));
    }
  }

  const boxCls = forceDark
    ? 'border border-white/10 bg-white/[0.03] text-white focus:ring-2 focus:ring-aurora-teal/40 focus:border-aurora-teal/40'
    : 'border border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-800 text-gray-900 dark:text-slate-100 focus:ring-2 focus:ring-aurora-teal';

  return (
    <div className="flex justify-center gap-2">
      {Array.from({ length }).map((_, i) => (
        <input
          key={i}
          ref={el => (inputRefs.current[i] = el)}
          type="text"
          inputMode="numeric"
          autoComplete={i === 0 ? 'one-time-code' : 'off'}
          maxLength={1}
          value={value[i] || ''}
          onChange={e => handleChange(i, e)}
          onKeyDown={e => handleKeyDown(i, e)}
          onPaste={e => handlePaste(i, e)}
          onFocus={e => e.target.select()}
          disabled={disabled}
          autoFocus={autoFocus && i === 0}
          className={`w-10 h-12 text-center text-lg font-semibold rounded-lg focus:outline-none disabled:opacity-50 ${boxCls}`}
        />
      ))}
    </div>
  );
}
