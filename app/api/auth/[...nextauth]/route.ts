import NextAuth from "next-auth"
import CredentialsProvider from "next-auth/providers/credentials"
import prisma from "@/lib/db"
import bcrypt from "bcryptjs"

const handler = NextAuth({
  providers: [
    CredentialsProvider({
      name: "Credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" }
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          return null
        }
        
        const user = await prisma.profile.findUnique({
          where: { email: credentials.email }
        })

        if (!user || (!user.password && credentials.password !== process.env.NEXT_PUBLIC_DEFAULT_ADMIN_PASSWORD)) {
          return null
        }

        // Extremely basic fallback for default admin before they change password
        let isValid = false;
        if (user.password) {
             isValid = await bcrypt.compare(credentials.password, user.password)
        } else if (credentials.email === process.env.NEXT_PUBLIC_DEFAULT_ADMIN_EMAIL && credentials.password === process.env.NEXT_PUBLIC_DEFAULT_ADMIN_PASSWORD) {
             isValid = true;
        }

        if (!isValid) {
          return null
        }

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          image: user.avatar_url,
          role: user.role
        }
      }
    })
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.role = (user as any).role
        token.id = user.id
      }
      return token
    },
    async session({ session, token }) {
      if (token && session.user) {
        (session.user as any).role = token.role;
        (session.user as any).id = token.id;
      }
      return session
    }
  },
  pages: {
    signIn: '/', // Landing page has the login form
  },
  session: {
    strategy: "jwt"
  }
})

export { handler as GET, handler as POST }
