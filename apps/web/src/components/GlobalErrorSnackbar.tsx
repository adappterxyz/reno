import { useEffect, useState } from "react";
import { Alert, Snackbar } from "@mui/material";

/**
 * Listens for `reno:api-error` window events (dispatched by the API client) and
 * shows them as a toast. Turns previously-silent fetch failures into visible
 * feedback everywhere in the app.
 */
export function GlobalErrorSnackbar() {
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<string>).detail;
      setMessage(detail || "Something went wrong");
    };
    window.addEventListener("reno:api-error", handler);
    return () => window.removeEventListener("reno:api-error", handler);
  }, []);

  return (
    <Snackbar
      open={!!message}
      autoHideDuration={6000}
      onClose={() => setMessage(null)}
      anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
    >
      <Alert severity="error" variant="filled" onClose={() => setMessage(null)}>
        {message}
      </Alert>
    </Snackbar>
  );
}
