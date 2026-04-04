import { render, screen } from "@testing-library/react";

import DashboardPage from "@/app/(app)/dashboard/page";

describe("DashboardPage", () => {
  it("renders the upload workflow content and uploader entry point", () => {
    render(<DashboardPage />);

    expect(
      screen.getByRole("heading", {
        name: /presigned pdf uploads now run inside the protected app/i,
      })
    ).toBeInTheDocument();
    expect(
      screen.getByText(/choose one or more pdf files/i)
    ).toBeInTheDocument();
  });
});
