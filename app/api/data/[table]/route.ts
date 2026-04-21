import { NextResponse } from 'next/server';
import prisma from '@/lib/db';

const getModel = (table: string) => {
    const modelName = table.toLowerCase() as any;
    if (modelName === 'loan_requests') return (prisma.loanRequest as any);
    if (modelName === 'deployment_records') return (prisma.deploymentRecord as any);
    if (modelName === 'equipment') return (prisma.equipment as any);
    if (modelName === 'vendors') return (prisma.vendor as any);
    if (modelName === 'companies') return (prisma.company as any);
    if (modelName === 'ships') return (prisma.ship as any);
    if (modelName === 'projects') return (prisma.project as any);
    if (modelName === 'profiles') return (prisma.profile as any);
    return null;
}

export async function GET(req: Request, context: any) {
    const { params } = await context;
    const table = params?.table;
    if (!table) return NextResponse.json({ error: 'Table not specified' }, { status: 400 });

    const model = getModel(table);
    if (!model) return NextResponse.json({ error: `Table ${table} not matching model` }, { status: 400 });

    try {
        const url = new URL(req.url);
        // Special case for our simple 'supbase mock' bridging
        const selectCols = url.searchParams.get('select') || '*';
        const orderBy = url.searchParams.get('order');
        const isAscending = url.searchParams.get('ascending') === 'true';

        let findArgs: any = {};
        
        if (orderBy) {
             findArgs.orderBy = { [orderBy]: isAscending ? 'asc' : 'desc' };
        } else if (table === 'equipment') {
             findArgs.orderBy = { created_at: 'desc' };
        } else if (table === 'loan_requests') {
             findArgs.orderBy = { date_created: 'desc' };
        } else if (table === 'deployment_records' || table === 'projects') {
             findArgs.orderBy = { create_date: 'desc' };
        }

        const data = await model.findMany(findArgs);
        return NextResponse.json({ data });
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

export async function POST(req: Request, context: any) {
    const { params } = await context;
    const table = params?.table;
    const body = await req.json();
    
    const model = getModel(table);
    if (!model) return NextResponse.json({ error: 'Model not found' }, { status: 400 });

    try {
        let resultData;
        const url = new URL(req.url);
        const isUpsert = url.searchParams.get('upsert') === 'true';

        if (isUpsert) {
             if (Array.isArray(body)) {
                 // naive bulk upsert
                 const results = [];
                 for(const item of body) {
                     if (item.id) {
                         const existing = await model.findUnique({ where: { id: item.id } });
                         if (existing) {
                             results.push(await model.update({ where: { id: item.id }, data: item }));
                         } else {
                             results.push(await model.create({ data: item }));
                         }
                     } else {
                         results.push(await model.create({ data: item }));
                     }
                 }
                 resultData = results;
             } else {
                 if (body.id) {
                     const existing = await model.findUnique({ where: { id: body.id } });
                     if (existing) {
                         resultData = await model.update({ where: { id: body.id }, data: body });
                     } else {
                         resultData = await model.create({ data: body });
                     }
                 } else {
                     resultData = await model.create({ data: body });
                 }
                 resultData = [resultData]; // return as array for supbase compat
             }
        } else {
             if (Array.isArray(body)) {
                 resultData = await model.createMany({ data: body });
                 // return the items conceptually to fulfill `.select()` emulation if needed
                 resultData = body;
             } else {
                 resultData = await model.create({ data: body });
                 // Ensure returning an array if a specific query expects it
                 resultData = [resultData];
             }
        }
        return NextResponse.json({ data: resultData, error: null }, { status: 201 });
    } catch (error: any) {
        return NextResponse.json({ data: null, error: error.message }, { status: 500 });
    }
}

export async function PUT(req: Request, context: any) {
    const { params } = await context;
    const table = params?.table;
    const body = await req.json();
    const url = new URL(req.url);
    const id = url.searchParams.get('id');

    const model = getModel(table);
    if (!model) return NextResponse.json({ error: 'Model not found' }, { status: 400 });

    if (!id) return NextResponse.json({ error: "ID required for PUT" }, { status: 400 });

    try {
        const data = await model.update({ where: { id }, data: body });
        return NextResponse.json({ data, error: null });
    } catch (error: any) {
        return NextResponse.json({ data: null, error: error.message }, { status: 500 });
    }
}

export async function DELETE(req: Request, context: any) {
    const { params } = await context;
    const table = params?.table;
    const url = new URL(req.url);
    const id = url.searchParams.get('id');
    const inIds = url.searchParams.get('in');

    const model = getModel(table);
    if (!model) return NextResponse.json({ error: 'Model not found' }, { status: 400 });

    try {
        let data;
        if (inIds) {
            const ids = inIds.split(',');
            data = await model.deleteMany({ where: { id: { in: ids } } });
        } else if (id) {
            data = await model.delete({ where: { id } });
        } else {
             return NextResponse.json({ error: "ID required for DELETE" }, { status: 400 });
        }
        return NextResponse.json({ data, error: null });
    } catch (error: any) {
        return NextResponse.json({ data: null, error: error.message }, { status: 500 });
    }
}
