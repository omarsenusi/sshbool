import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export function FontSelector({
  value,
  onChange,
  onSave,
  isSaving,
  label,
  description,
  popularFonts,
}: {
  value: string
  onChange: (v: string) => void
  onSave: () => void
  isSaving: boolean
  label: string
  description: string
  popularFonts: string[]
}) {
  return (
    <div className="max-w-md space-y-3">
      <div>
        <h3 className="text-sm font-semibold">{label}</h3>
        <p className="mt-1 mb-3 text-xs text-muted-foreground">{description}</p>

        <div className="mb-3 flex flex-wrap gap-2">
          {popularFonts.map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => onChange(f)}
              className={cn(
                "rounded-md border px-2.5 py-1 text-xs transition-colors",
                value === f
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-background text-foreground hover:bg-muted"
              )}
            >
              {f}
            </button>
          ))}
          <button
            type="button"
            onClick={() => onChange("")}
            className={cn(
              "rounded-md border px-2.5 py-1 text-xs transition-colors",
              !value
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-background text-foreground hover:bg-muted"
            )}
          >
            Default
          </button>
        </div>

        <div className="flex gap-2">
          <input
            type="text"
            className="flex-1 rounded-md border border-input bg-background px-2 py-1.5 text-sm"
            placeholder="Custom Google Font (e.g. Almarai)"
            value={value}
            onChange={(e) => onChange(e.target.value)}
          />
          <Button size="sm" onClick={onSave} disabled={isSaving}>
            {isSaving ? "Saving..." : "Save Font"}
          </Button>
        </div>
        {value.trim() && (
          <style>{`@import url('https://fonts.googleapis.com/css2?family=${value.trim().replace(/ /g, "+")}:wght@400;500;600&display=swap');`}</style>
        )}
        <div className="mt-4 rounded-md border bg-card text-card-foreground shadow-sm">
          <div
            className="flex items-center justify-between border-b border-border/50 px-3 py-2"
            style={{ fontFamily: "system-ui, sans-serif" }}
          >
            <span className="text-xs font-medium">Preview</span>
            <span className="text-[10px] text-muted-foreground">
              {value.trim() || "System Default"}
            </span>
          </div>

          <div
            className="space-y-2 px-3 py-3"
            style={{
              fontFamily: value.trim()
                ? `"${value.trim()}", system-ui, sans-serif`
                : undefined,
            }}
          >
            {document.documentElement.lang === "ar" ||
            document.documentElement.dir === "rtl" ||
            navigator.language.startsWith("ar") ? (
              <p className="text-right text-sm text-foreground" dir="rtl">
                أبجد هوز حطي كلمن سعفص قرشت.
              </p>
            ) : (
              <p className="text-sm text-foreground">
                The quick brown fox jumps over the lazy dog.
              </p>
            )}
            <p className="text-xs break-all text-muted-foreground">
              0123456789 !@#$%^&*()
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
