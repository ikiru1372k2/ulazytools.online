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
    expect(screen.getByRole("link", { name: /open tool/i })).toHaveAttribute(
      "href",
      "/dashboard"
    );
    expect(screen.getAllByText(/coming soon/i)).toHaveLength(3);
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

  it("does not render planned tools as active links", () => {
    render(<ToolsPage />);

    expect(
      screen.queryByRole("link", { name: /merge and organize pdfs/i })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /extract text and data/i })
    ).not.toBeInTheDocument();
  });
});
