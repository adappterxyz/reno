import { useAuth0 } from "@auth0/auth0-react";
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

export function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth0();
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
          {user?.picture ? (
            <Avatar src={user.picture} sx={{ width: 32, height: 32, mr: 2 }} />
          ) : null}
          <Button onClick={() => logout({ logoutParams: { returnTo: window.location.origin } })}>
            Sign out
          </Button>
        </Toolbar>
      </AppBar>
      <Container maxWidth="lg" sx={{ py: 4 }}>
        {children}
      </Container>
    </Box>
  );
}
