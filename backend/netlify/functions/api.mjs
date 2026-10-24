import serverless from "serverless-http";
import app from "../../dist/app.js";

// Route the existing Express API at the same-origin /api/* paths used by the UI.
// The database URI and JWT secret are supplied by Netlify runtime environment variables.
export const handler = serverless(app);
export const config = { path: ["/api/*"] };
