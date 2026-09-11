import { Upload } from "lucide-react"

export function DropOverlay({ visible }: { visible: boolean }) {
  if (!visible) return null
  return (
    <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center bg-background/80 backdrop-blur-[2px]">
      <div className="flex flex-col items-center gap-3 rounded-2xl border-2 border-dashed border-primary/40 bg-card px-10 py-8 shadow-lg">
        <Upload className="size-10 text-primary" />
        <div className="text-center">
          <div className="text-sm font-semibold">Drop files to upload</div>
          <p className="mt-1 text-xs text-muted-foreground">
            Drop onto the remote pane to upload here
          </p>
        </div>
      </div>
    </div>
  )
}
