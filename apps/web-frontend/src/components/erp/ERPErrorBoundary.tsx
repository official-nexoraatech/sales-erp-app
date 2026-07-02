import { Component, type ReactNode, type ErrorInfo } from 'react';
import ERPEmptyState from './ERPEmptyState.js';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
}

export default class ERPErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ERPErrorBoundary]', error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        this.props.fallback ?? (
          <div className="flex items-center justify-center min-h-[400px]">
            <ERPEmptyState
              type="error"
              action={{ label: 'Reload page', onClick: () => window.location.reload() }}
            />
          </div>
        )
      );
    }
    return this.props.children;
  }
}
