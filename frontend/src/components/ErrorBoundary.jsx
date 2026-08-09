import { Component } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

// Catches unexpected render errors anywhere below it in the tree. Without this,
// a single bad state or bug in one screen (e.g. Inbox) crashes the entire React
// app to a blank white page for whoever's using it — bad during a live shift.
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    console.error('UI crashed:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50 p-6">
          <div className="text-center max-w-sm">
            <div className="w-12 h-12 rounded-full bg-rose-100 flex items-center justify-center mx-auto mb-4">
              <AlertTriangle size={22} className="text-rose-500" />
            </div>
            <h1 className="font-semibold text-gray-900 mb-1">เกิดข้อผิดพลาดบางอย่าง</h1>
            <p className="text-sm text-gray-500 mb-5">หน้านี้มีปัญหาชั่วคราว ลองรีเฟรชอีกครั้ง ข้อมูลของคุณยังปลอดภัยอยู่</p>
            <button
              onClick={() => window.location.reload()}
              className="inline-flex items-center gap-2 bg-aurora-tealDeep text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-aurora-teal transition-colors"
            >
              <RefreshCw size={15} /> รีเฟรชหน้า
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
