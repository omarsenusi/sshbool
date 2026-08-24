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
    <div className="space-y-3 max-w-md">
      <div>
        <h3 className="text-sm font-semibold">{label}</h3>
        <p className="text-muted-foreground mt-1 text-xs mb-3">{description}</p>

        <div className="flex flex-wrap gap-2 mb-3">
          {popularFonts.map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => onChange(f)}
              className={cn(
                "px-2.5 py-1 text-xs rounded-md border transition-colors",
                value === f
                  ? "bg-primary text-primary-foreground border-primary"
                  : "hover:bg-muted bg-background border-border text-foreground",
              )}
            >
              {f}
            </button>
          ))}
          <button
            type="button"
            onClick={() => onChange("")}
            className={cn(
              "px-2.5 py-1 text-xs rounded-md border transition-colors",
              !value
                ? "bg-primary text-primary-foreground border-primary"
                : "hover:bg-muted bg-background border-border text-foreground",
            )}
          >
            Default
          </button>
        </div>

        <div className="flex gap-2">
          <input
            type="text"
            className="border-input bg-background flex-1 rounded-md border px-2 py-1.5 text-sm"
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
            className="flex items-center justify-between px-3 py-2 border-b border-border/50"
            style={{ fontFamily: "system-ui, sans-serif" }}
          >
            <span className="text-xs font-medium">Preview</span>
            <span className="text-[10px] text-muted-foreground">
              {value.trim() || "System Default"}
            </span>
          </div>

          <div
            className="px-3 py-3 space-y-2"
            style={{
              fontFamily: value.trim() ? `"${value.trim()}", system-ui, sans-serif` : undefined,
            }}
          >
            {document.documentElement.lang === "ar" ||
            document.documentElement.dir === "rtl" ||
            navigator.language.startsWith("ar") ? (
              <p className="text-sm text-foreground text-right" dir="rtl">
                أبجد هوز حطي كلمن سعفص قرشت.
              </p>
            ) : (
              <p className="text-sm text-foreground">
                The quick brown fox jumps over the lazy dog.
              </p>
            )}
            <p className="text-xs text-muted-foreground break-all">0123456789 !@#$%^&*()</p>
          </div>
        </div>
      </div>
    </div>
  )
}
