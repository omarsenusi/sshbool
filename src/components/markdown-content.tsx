function renderBoldText(text: string) {
  const parts = text.split(/(\*\*.*?\*\*)/g)
  return parts.map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return (
        <strong key={index} className="font-semibold text-foreground">
          {part.slice(2, -2)}
        </strong>
      )
    }
    return part
  })
}

function renderInlineLinks(text: string) {
  const urlPattern = /(https?:\/\/[^\s]+)/g
  const parts = text.split(urlPattern)
  return parts.map((part, index) => {
    if (/^https?:\/\//.test(part)) {
      return (
        <a
          key={index}
          href={part}
          target="_blank"
          rel="noreferrer"
          className="text-primary underline-offset-2 hover:underline"
        >
          {part}
        </a>
      )
    }
    return <span key={index}>{renderBoldText(part)}</span>
  })
}

export function MarkdownContent({ content }: { content: string }) {
  const lines = content.split("\n")

  return (
    <div className="space-y-1">
      {lines.map((line, index) => {
        const trimmed = line.trim()

        if (trimmed.startsWith("# ")) {
          return (
            <h3 key={index} className="text-base font-semibold">
              {trimmed.slice(2)}
            </h3>
          )
        }
        if (trimmed.startsWith("## ")) {
          return (
            <h4 key={index} className="text-sm font-semibold">
              {trimmed.slice(3)}
            </h4>
          )
        }
        if (trimmed.startsWith("### ")) {
          return (
            <h5 key={index} className="text-sm font-medium">
              {trimmed.slice(4)}
            </h5>
          )
        }
        if (trimmed.startsWith("* ") || trimmed.startsWith("- ")) {
          return (
            <li
              key={index}
              className="ml-4 list-disc text-xs leading-relaxed text-muted-foreground"
            >
              {renderInlineLinks(trimmed.slice(2))}
            </li>
          )
        }
        if (trimmed === "---") {
          return <hr key={index} className="my-3 border-border" />
        }
        if (trimmed === "") {
          return <div key={index} className="h-1" />
        }

        return (
          <p
            key={index}
            className="text-xs leading-relaxed text-muted-foreground"
          >
            {renderInlineLinks(trimmed)}
          </p>
        )
      })}
    </div>
  )
}
