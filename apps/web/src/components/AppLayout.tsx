import {
  AppBar,
  Avatar,
  Box,
  Button,
  Container,
  Toolbar,
  Typography,
} from "@mui/material";
import ViewInArIcon from "@mui/icons-material/ViewInAr";
import { Link } from "react-router-dom";
import { useAuth } from "../auth/AuthContext.js";

export function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth();
  return (
    <Box sx={{ minHeight: "100vh", bgcolor: "background.default" }}>
      <AppBar position="sticky" color="inherit" elevation={0} sx={{ borderBottom: "1px solid #eceef3" }}>
        <Toolbar>
          <ViewInArIcon color="primary" sx={{ mr: 1 }} />
          <Typography
            variant="h6"
            component={Link}
            to="/projects"
            sx={{ color: "text.primary", textDecoration: "none", flexGrow: 0, mr: 4 }}
          >
            Reno
          </Typography>
          <Box sx={{ flexGrow: 1 }} />
          {user?.email ? (
            <>
              <Avatar sx={{ width: 32, height: 32, mr: 1, bgcolor: "primary.main", fontSize: 14 }}>
                {user.email[0]?.toUpperCase()}
              </Avatar>
              <Typography variant="body2" color="text.secondary" sx={{ mr: 2 }}>
                {user.email}
              </Typography>
            </>
          ) : null}
          <Button onClick={() => logout()}>Sign out</Button>
        </Toolbar>
      </AppBar>
      <Container maxWidth="lg" sx={{ py: 4 }}>
        {children}
      </Container>
    </Box>
  );
}
