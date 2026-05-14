import React from 'react';

interface Props {
  children: React.ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-gray-950 text-white p-8">
          <div className="bg-gray-800 rounded-xl border border-red-700 p-8 max-w-lg">
            <h2 className="text-xl font-bold text-red-400 mb-3">Error inesperado</h2>
            <p className="text-gray-300 text-sm mb-4">
              Algo salió mal al renderizar esta sección. Puedes recargar la página o probar con otra pestaña.
            </p>
            <details className="text-xs text-gray-500">
              <summary className="cursor-pointer hover:text-gray-300">Detalles técnicos</summary>
              <pre className="mt-2 p-3 bg-gray-900 rounded overflow-auto max-h-48">
                {this.state.error?.message}
              </pre>
            </details>
            <button
              onClick={() => window.location.reload()}
              className="mt-4 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm transition-colors"
            >
              Recargar página
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
