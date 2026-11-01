import { createTheme } from "@mui/material/styles";

/** A single, modern design system (replaces the old MUI+AntD+Bootstrap mix). */
export const theme = createTheme({
  palette: {
    mode: "light",
    primary: { main: "#2f6df6" },
    secondary: { main: "#17b890" },
    background: { default: "#f5f7fb", paper: "#ffffff" },
  },
  shape: { borderRadius: 12 },
  typography: {
    fontFamily: "Inter, system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
    h5: { fontWeight: 700 },
    h6: { fontWeight: 700 },
  },
  components: {
    MuiButton: { defaultProps: { disableElevation: true }, styleOverrides: { root: { textTransform: "none", fontWeight: 600 } } },
    MuiCard: { styleOverrides: { root: { border: "1px solid #eceef3" } } },
  },
});
