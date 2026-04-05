export type PendingJobStatus = {
  status: "pending";
};

export type ProcessingJobStatus = {
  status: "processing";
};

export type DoneJobStatus = {
  downloadUrl: string;
  status: "done";
};

export type FailedJobStatus = {
  errorCode?: string;
  lastError?: string;
  status: "failed";
};

export type CanceledJobStatus = {
  status: "canceled";
};

export type JobStatusResponse =
  | PendingJobStatus
  | ProcessingJobStatus
  | DoneJobStatus
  | FailedJobStatus
  | CanceledJobStatus;

export type JobErrorResponse = {
  error: {
    code: string;
    message: string;
  };
};

export function getJobStatusLabel(status: JobStatusResponse["status"]) {
  switch (status) {
    case "pending":
      return "Pending";
    case "processing":
      return "Processing";
    case "done":
      return "Done";
    case "failed":
      return "Failed";
    case "canceled":
      return "Canceled";
  }
}

export function isTerminalJobStatus(
  status: JobStatusResponse["status"]
): boolean {
  return status === "done" || status === "failed" || status === "canceled";
}
