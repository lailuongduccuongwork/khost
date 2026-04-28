import React from 'react';

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

class ErrorBoundary extends React.Component<React.PropsWithChildren, ErrorBoundaryState> {
  state: ErrorBoundaryState = {
    hasError: false,
    message: '',
  };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      message: error?.message || 'Ứng dụng gặp lỗi ngoài ý muốn.',
    };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('Application render failed', { error, errorInfo });
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center p-6">
        <div className="max-w-lg w-full rounded-2xl border border-white/10 bg-white/10 p-6 shadow-2xl">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-blue-200">K-Host</p>
          <h1 className="mt-3 text-2xl font-black">Ứng dụng vừa gặp lỗi hiển thị</h1>
          <p className="mt-3 text-sm text-slate-200">
            Dữ liệu chưa bị xóa. Hãy tải lại trang để mở lại ứng dụng. Nếu lỗi lặp lại, chụp màn hình này và gửi cho người quản trị.
          </p>
          <pre className="mt-4 max-h-32 overflow-auto rounded-xl bg-black/30 p-3 text-xs text-red-100 whitespace-pre-wrap">
            {this.state.message}
          </pre>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-5 w-full rounded-xl bg-blue-600 px-4 py-3 text-sm font-bold text-white hover:bg-blue-500"
          >
            Tải lại ứng dụng
          </button>
        </div>
      </div>
    );
  }
}

export default ErrorBoundary;
