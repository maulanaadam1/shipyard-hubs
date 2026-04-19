import { NextResponse } from 'next/server';
import prisma from '@/lib/db';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { email, password } = body;

    let user = await prisma.profile.findUnique({
      where: { email },
    });

    if (user) {
      return NextResponse.json(
        { error: 'User already exists with that email' },
        { status: 400 }
      );
    }

    const bcrypt = require('bcryptjs');
    const hashedPassword = await bcrypt.hash(password, 10);

    user = await prisma.profile.create({
      data: {
        email,
        password: hashedPassword,
        name: email.split('@')[0],
        role: 'Staff',
      },
    });

    return NextResponse.json({ user }, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
