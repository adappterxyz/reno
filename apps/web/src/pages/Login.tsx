import { useState } from "react";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import ViewInArIcon from "@mui/icons-material/ViewInAr";
import { useAuth } from "../auth/AuthContext.js";

export function Login() {
  const { requestOtp, verifyOtp } = useAuth();
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const sendCode = async () => {
    setBusy(true);
    setError(null);
    try {
      const { devCode } = await requestOtp(email);
      setStep("code");
      setInfo(devCode ? `Dev mode — your code is ${devCode}` : `Code sent to ${email}.`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    setBusy(true);
    setError(null);
    try {
      await verifyOtp(email, code);
      // AuthProvider sets the user; App re-renders into the app.
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Box sx={{ minHeight: "100vh", display: "grid", placeItems: "center", p: 3 }}>
      <Card sx={{ width: 400, maxWidth: "100%" }}>
        <CardContent sx={{ p: 4 }}>
          <Stack spacing={1} alignItems="center" mb={3}>
            <ViewInArIcon color="primary" sx={{ fontSize: 40 }} />
            <Typography variant="h5">Reno</Typography>
            <Typography color="text.secondary" variant="body2" align="center">
              Sign in with your email — we'll send a one-time code.
            </Typography>
          </Stack>

          {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
          {info && <Alert severity="info" sx={{ mb: 2 }}>{info}</Alert>}

          {step === "email" ? (
            <Stack spacing={2}>
              <TextField
                label="Email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && email && sendCode()}
                autoFocus
                fullWidth
              />
              <Button variant="contained" size="large" onClick={sendCode} disabled={!email || busy}>
                Send code
              </Button>
            </Stack>
          ) : (
            <Stack spacing={2}>
              <TextField
                label="6-digit code"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                onKeyDown={(e) => e.key === "Enter" && code.length === 6 && verify()}
                inputProps={{ inputMode: "numeric", style: { letterSpacing: 8, fontSize: 24, textAlign: "center" } }}
                autoFocus
                fullWidth
              />
              <Button variant="contained" size="large" onClick={verify} disabled={code.length !== 6 || busy}>
                Verify & sign in
              </Button>
              <Button size="small" onClick={() => { setStep("email"); setCode(""); setInfo(null); }}>
                Use a different email
              </Button>
            </Stack>
          )}
        </CardContent>
      </Card>
    </Box>
  );
}
