import { Check, Monitor, Moon, Sun } from "lucide-react";
import {
  FONT_SIZE_DEFAULT,
  FONT_SIZE_MAX,
  FONT_SIZE_MIN,
  useUi,
  type ThemeMode,
} from "@/store/ui";
import { cn } from "@/lib/utils";

const THEMES: { value: ThemeMode; label: string; hint: string; icon: typeof Sun }[] = [
  { value: "light", label: "浅色", hint: "始终使用亮色界面", icon: Sun },
  { value: "dark", label: "暗色", hint: "始终使用暗色界面", icon: Moon },
  { value: "system", label: "跟随系统", hint: "随 macOS 外观自动切换", icon: Monitor },
];

export function AppearanceSection() {
  const theme = useUi((s) => s.theme);
  const setTheme = useUi((s) => s.setTheme);
  const fontSize = useUi((s) => s.fontSize);
  const setFontSize = useUi((s) => s.setFontSize);

  return (
    <div>
      <div className="text-[11px] font-medium uppercase tracking-[0.06em] text-muted-foreground">
        主题
      </div>
      <div className="mt-2 grid grid-cols-3 gap-2">
        {THEMES.map((option) => {
          const active = theme === option.value;
          return (
            <button
              key={option.value}
              onClick={() => setTheme(option.value)}
              aria-pressed={active}
              className={cn(
                "flex flex-col items-start gap-1 rounded-lg border px-2.5 py-2.5 text-left transition-colors",
                active
                  ? "border-brand/60 bg-brand-soft"
                  : "border-border hover:bg-accent/60",
              )}
            >
              <div className="flex w-full items-center gap-1.5">
                <option.icon
                  className={cn("size-3.5", active ? "text-brand" : "text-muted-foreground")}
                  strokeWidth={1.8}
                />
                <span className="flex-1 text-[12.5px] font-medium">{option.label}</span>
                {active && <Check className="size-3.5 text-brand" />}
              </div>
              <span className="text-[10.5px] leading-snug text-muted-foreground">
                {option.hint}
              </span>
            </button>
          );
        })}
      </div>
      <p className="mt-3 text-[11.5px] leading-relaxed text-muted-foreground">
        主题立即生效并记住你的选择；界面主色是低饱和蓝 #4a6fa5。
      </p>

      <div className="mt-6 border-t border-border/70 pt-4">
        <div className="flex items-center justify-between">
          <div className="text-[11px] font-medium uppercase tracking-[0.06em] text-muted-foreground">
            正文大小
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[12px] font-medium tabular-nums text-brand">{fontSize}px</span>
            {fontSize !== FONT_SIZE_DEFAULT && (
              <button
                onClick={() => setFontSize(FONT_SIZE_DEFAULT)}
                className="text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
              >
                恢复默认
              </button>
            )}
          </div>
        </div>

        <div className="mt-2 flex items-center gap-2.5">
          <span className="w-6 text-right text-[10.5px] tabular-nums text-muted-foreground/70">
            {FONT_SIZE_MIN}
          </span>
          <input
            type="range"
            min={FONT_SIZE_MIN}
            max={FONT_SIZE_MAX}
            step={1}
            value={fontSize}
            onChange={(e) => setFontSize(Number(e.target.value))}
            aria-label="正文字号"
            className="h-1.5 min-w-0 flex-1 cursor-pointer appearance-none rounded-full bg-muted outline-none [&::-webkit-slider-thumb]:size-3.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-brand [&::-webkit-slider-thumb]:shadow-sm"
          />
          <span className="w-6 text-[10.5px] tabular-nums text-muted-foreground/70">
            {FONT_SIZE_MAX}
          </span>
        </div>

        <p
          className="mt-2.5 rounded-md bg-muted/50 px-2.5 py-2 leading-relaxed text-foreground/85"
          style={{ fontSize: `${fontSize}px` }}
        >
          预览：好的笔记应该让人愿意反复回看。
        </p>
        <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
          只影响正文与标题，不影响侧栏与菜单；默认 {FONT_SIZE_DEFAULT}px。
        </p>
      </div>
    </div>
  );
}
