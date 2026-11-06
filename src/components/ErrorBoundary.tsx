import { Component, type ErrorInfo, type ReactNode } from "react";
import { reportClientError } from "@/lib/diagnostics";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
  info: string;
  logPath: string;
  copied: boolean;
}

/**
 * Last line of defence.
 *
 * Without a boundary an error anywhere in the tree unmounts React and leaves an
 * empty white window — the least debuggable way for a desktop app to fail. This
 * keeps the message, the component stack and the path of the log file on screen,
 * and lets the user copy the whole thing.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, info: "", logPath: "", copied: false };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    const detail = [
      `render error: ${error.message}`,
      error.stack ?? "",
      info.componentStack ?? "",
    ].join("\n");
    void import("@tauri-apps/api/core")
      .then(({ invoke }) => invoke<string>("report_client_error", { message: detail }))
      .then((path) => this.setState({ logPath: path }))
      .catch(() => undefined);
    this.setState({ info: info.componentStack ?? "" });
  }

  private copy = async () => {
    const text = [
      this.state.error?.message ?? "",
      this.state.error?.stack ?? "",
      this.state.info,
    ].join("\n");
    try {
      await navigator.clipboard.writeText(text);
      this.setState({ copied: true });
      window.setTimeout(() => this.setState({ copied: false }), 1600);
    } catch {
      reportClientError(`copy failed: ${text}`);
    }
  };

  render() {
    const { error, info, logPath, copied } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="flex h-full w-full items-center justify-center bg-background p-6 text-foreground">
        <div className="w-full max-w-[620px] rounded-xl border border-border bg-popover p-5 shadow-lg">
          <div className="text-[15px] font-semibold">界面遇到了一个错误</div>
          <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">
            文档本身没有受到影响，内容仍然保存在磁盘上。可以重新加载界面，或把下面的信息反馈给开发者。
          </p>

          <pre className="scroller mt-3 max-h-[240px] overflow-auto rounded-lg bg-muted p-3 text-[11.5px] leading-relaxed">
            {error.message}
            {error.stack ? `\n\n${error.stack}` : ""}
            {info ? `\n\n${info}` : ""}
          </pre>

          {logPath && (
            <p className="mt-2 break-all text-[11px] text-muted-foreground/80">
              已记录到：{logPath}
            </p>
          )}

          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="rounded-md bg-primary px-3 py-1.5 text-[12.5px] font-medium text-primary-foreground"
            >
              重新加载
            </button>
            <button
              type="button"
              onClick={() => void this.copy()}
              className="rounded-md border border-border px-3 py-1.5 text-[12.5px]"
            >
              {copied ? "已复制" : "复制错误信息"}
            </button>
          </div>
        </div>
      </div>
    );
  }
}
