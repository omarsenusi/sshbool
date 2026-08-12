import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { HostRow } from "@/features/connections/components/host-row"

describe("HostRow", () => {
  it("shows the server name instead of only an icon", () => {
    render(<HostRow label="edge-router-01" accent="#0d9488" status="idle" />)
    expect(screen.getByText("edge-router-01")).toBeInTheDocument()
  })

  it("falls back to the host letter when no icon is set", () => {
    render(<HostRow label="brisbane-core" accent="#2563eb" status="idle" />)
    expect(screen.getByText("B")).toBeInTheDocument()
  })

  it("renders the host icon when one is provided", () => {
    const { container } = render(
      <HostRow
        label="nokia-sr"
        accent="#2563eb"
        icon="data:image/png;base64,iVBORw0KGgo="
        status="idle"
      />,
    )
    expect(container.querySelector("img")).not.toBeNull()
    expect(screen.queryByText("N")).toBeNull()
  })

  it("marks the selected row via aria-current", () => {
    render(
      <HostRow label="core-1" accent="#2563eb" status="connected" selected />,
    )
    expect(screen.getByRole("button")).toHaveAttribute("aria-current", "true")
  })

  it("flags a connecting host as busy", () => {
    render(<HostRow label="core-1" accent="#2563eb" status="connecting" />)
    expect(screen.getByRole("button")).toHaveAttribute("aria-busy", "true")
  })

  it("prefers the status title over the bare label", () => {
    render(
      <HostRow
        label="core-1"
        accent="#2563eb"
        status="error"
        title="core-1 — Connection refused"
      />,
    )
    expect(screen.getByRole("button")).toHaveAttribute(
      "title",
      "core-1 — Connection refused",
    )
  })

  it("fires onClick when activated", async () => {
    const onClick = vi.fn()
    render(
      <HostRow
        label="core-1"
        accent="#2563eb"
        status="idle"
        onClick={onClick}
      />,
    )
    screen.getByRole("button").click()
    expect(onClick).toHaveBeenCalledOnce()
  })
})
