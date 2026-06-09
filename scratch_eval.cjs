const fs = require('fs');
const path = require('path');

const filePath = path.join(process.cwd(), 'WOXA.json');
const rawData = fs.readFileSync(filePath, 'utf-8');
const dynamic = JSON.parse(rawData);

let repairList = [];
let dataObj = dynamic;
if (dynamic.data) {
    if (Array.isArray(dynamic.data.repair_list)) {
        repairList = dynamic.data.repair_list;
    }
    dataObj = dynamic.data;
} else if (Array.isArray(dynamic.repair_list)) {
    repairList = dynamic.repair_list;
}

let isGlobalApproved = false;
if (dataObj.t_job_order && dataObj.t_job_order.approval_status) {
    if (dataObj.t_job_order.approval_status.trim().toLowerCase() === 'approved') {
        isGlobalApproved = true;
    }
}

const dailyCosts = {};

function processItems(items) {
    for (const item of items) {
        if (item.material && Array.isArray(item.material) && item.material.length > 0) {
            processItems(item.material);
        } else {
            const approvedLevel = Number(item.approved_level) || 0;
            const statusAppr = (item.status_approval || '').trim().toLowerCase();

            let costToAdd = 0;
            if (Number(item.volume_cost_final) > 0) {
                const vol = Number(item.volume) || 0;
                const prog = item.progress !== undefined ? Number(item.progress) : 100;
                costToAdd = Number(item.volume_cost_final) * vol * (prog / 100);
            } else if (Number(item.total_price) > 0) {
                costToAdd = Number(item.total_price);
            } else if (Number(item.price) > 0) {
                costToAdd = Number(item.price);
            }

            const isAppr = approvedLevel >= 5 || isGlobalApproved || statusAppr === 'approved';

            if (isAppr) {
                const dateToUse = item.date_approval || item.updated_at || item.created_at;
                if (dateToUse) {
                    const dateOnly = dateToUse.split(' ')[0];
                    dailyCosts[dateOnly] = (dailyCosts[dateOnly] || 0) + costToAdd;
                }
            }
        }
    }
}

processItems(repairList);

let latestDate = '';
let finalDailyCost = 0;

for (const d in dailyCosts) {
    if (d > latestDate) {
        latestDate = d;
    }
}

if (latestDate) {
    finalDailyCost = dailyCosts[latestDate];
}

console.log('--- HASIL KALKULASI ---');
console.log('Daily Costs Mapping:', JSON.stringify(dailyCosts, null, 2));
console.log('Tanggal Terakhir (Latest Date):', latestDate);
console.log('Biaya Harian (Terakhir): Rp ' + finalDailyCost.toLocaleString('id-ID'));
