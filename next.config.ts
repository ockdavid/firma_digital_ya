import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // better-sqlite3 es un módulo nativo: no puede pasar por el bundler.
  serverExternalPackages: ["better-sqlite3"],
};

export default nextConfig;
