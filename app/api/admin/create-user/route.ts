import { NextResponse } from 'next/server';
import prisma from '@/lib/db';

export async function POST(req: Request) {
  try {
    const { name, email, role, password } = await req.json();

    // Validate request
    if (!email || !role || !name) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    // Check if user already exists
    const existingUser = await prisma.profile.findUnique({
      where: { email }
    });

    if (existingUser) {
      return NextResponse.json({ error: 'User already exists with this email' }, { status: 400 });
    }

    // Since we're making auth independent, we hash password manually
    const bcrypt = require('bcryptjs');
    const hashedPassword = await bcrypt.hash(password || 'Shipyard123!', 10);

    const newUser = await prisma.profile.create({
      data: {
        email,
        password: hashedPassword,
        name,
        role
      }
    });

    return NextResponse.json({ 
      message: 'User created successfully', 
      user: { id: newUser.id, email: newUser.email, role: newUser.role } 
    });

  } catch (error: any) {
    console.error('Admin create user error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
