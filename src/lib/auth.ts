import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@/lib/db";
import { getAuthEnv } from "@/lib/env";

const authEnv = getAuthEnv();

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  secret: authEnv.AUTH_SECRET,
  session: {
    strategy: "database",
  },
  providers: [
    Google({
      clientId: authEnv.AUTH_GOOGLE_ID,
      clientSecret: authEnv.AUTH_GOOGLE_SECRET,
    }),
  ],
  pages: {
    signIn: "/login",
  },
});
