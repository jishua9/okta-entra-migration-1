import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import db from "@/lib/db";
import { getAppSecret } from "@/lib/secret";

type UserRow = { id: string; email: string; password_hash: string };

export const authOptions: NextAuthOptions = {
  secret: getAppSecret(),
  providers: [
    CredentialsProvider({
      name: "Email",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;
        const user = db
          .prepare("SELECT * FROM users WHERE email = ?")
          .get(credentials.email) as UserRow | undefined;
        if (!user) return null;
        const valid = await bcrypt.compare(credentials.password, user.password_hash);
        if (!valid) return null;
        return { id: user.id, email: user.email, name: user.email };
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user) token.userId = user.id;
      return token;
    },
    session({ session, token }) {
      return { ...session, user: { ...session.user, id: token.userId as string } };
    },
  },
  pages: {
    signIn: "/login",
  },
};
