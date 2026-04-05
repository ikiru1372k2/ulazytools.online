import { fireEvent, render, screen } from "@testing-library/react";

import ToolsPage from "@/app/(tools)/tools/page";

describe("ToolsPage", () => {
  it("renders the tools hub heading and all tool cards", () => {
    render(<ToolsPage />);

    expect(
      screen.getByRole("heading", {
        name: /browse every shipped and upcoming document workflow/i,
      })
    ).toBeInTheDocument();

    expect(
      screen.getByRole("heading", { name: /pdf upload dashboard/i })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /merge and organize pdfs/i })
    ).toBeInTheDocument();
    const links = screen.getAllByRole("link", { name: /open tool/i });
    expect(links).toHaveLength(2);
    expect(links[0]).toHaveAttribute("href", "/dashboard");
    expect(links[1]).toHaveAttribute("href", "/merge");
    expect(screen.getAllByText(/coming soon/i)).toHaveLength(2);
  });

  it("filters tool cards client-side", () => {
    render(<ToolsPage />);

    fireEvent.change(screen.getByLabelText(/search tools/i), {
      target: { value: "extract" },
    });

    expect(
      screen.getByRole("heading", { name: /extract text and data/i })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: /pdf upload dashboard/i })
    ).not.toBeInTheDocument();
  });

  it("renders an empty state when no tool cards match", () => {
    render(<ToolsPage />);

    fireEvent.change(screen.getByLabelText(/search tools/i), {
      target: { value: "nonexistent-tool" },
    });

    expect(
      screen.getByText(/no tools match that search/i)
    ).toBeInTheDocument();
  });

  it("renders the merge tool as an active link", () => {
    render(<ToolsPage />);

    expect(screen.getAllByRole("link", { name: /open tool/i })[1]).toHaveAttribute(
      "href",
      "/merge"
    );
    expect(
      screen.queryByRole("link", { name: /extract text and data/i })
    ).not.toBeInTheDocument();
  });
});
