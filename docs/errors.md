# Error Taxonomy

The API now returns errors in a shared JSON shape:

```json
{
  "error": {
    "code": "UPLOAD_TOO_LARGE",
    "message": "File exceeds the 10MB upload limit"
  }
}
```

## Shared behavior

- API routes use a shared mapper from `src/app/api/_utils/http.ts`.
- Unknown internal failures are normalized to a safe internal error shape.
- Stack traces and raw exception details are never sent to clients.
- Rate-limited responses include `Retry-After`.

## Stable codes introduced here

- `NOT_FOUND`
- `RATE_LIMITED`
- `INTERNAL_ERROR`
- `UPLOAD_INVALID_REQUEST`
- `UPLOAD_INVALID_TYPE`
- `UPLOAD_TOO_LARGE`
- `UPLOAD_PRESIGN_FAILED`
- `FILE_NOT_FOUND`
- `INVALID_STATE_TRANSITION`
- `UPLOAD_NOT_VISIBLE_YET`
- `SIZE_MISMATCH`
- `ETAG_MISMATCH`
- `UPLOAD_VERIFICATION_FAILED`
- `JOB_EXPIRED`
- `JOB_STATUS_UNAVAILABLE`
- `JOB_NOT_READY`
- `DOWNLOAD_URL_CREATION_FAILED`
- `JOB_NOT_FOUND`
- `JOB_TYPE_MISMATCH`
- `PDF_OUTPUT_WRITE_FAILED`
- `PDF_INPUT_NOT_FOUND`
- `PDF_ENCRYPTED`
- `PDF_CORRUPT`
- `PDF_MERGE_FAILED`

## Current route coverage

- `POST /api/upload/presign`
- `POST /api/upload/complete`
- `GET /api/jobs/[jobId]`
- `GET /api/download/[jobId]`

## Worker usage

The PDF worker uses the same taxonomy when persisting job failure codes. Known app errors keep their stable code, and unknown failures fall back to `INTERNAL_ERROR`.
