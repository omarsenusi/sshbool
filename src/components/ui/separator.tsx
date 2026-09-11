import { cn } from "@/lib/utils"
export function Separator({ className }: { className?: string }) {
  return <div className={cn("h-[1px] w-full shrink-0 bg-border", className)} />
}
