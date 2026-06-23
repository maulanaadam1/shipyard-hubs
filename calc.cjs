const fs = require('fs');

function parseFloatAny(val) {
    if (val === null || val === undefined) return 0;
    if (typeof val === 'number') return val;
    if (typeof val === 'string') {
        const parsed = parseFloat(val.trim());
        return isNaN(parsed) ? 0 : parsed;
    }
    return 0;
}

function calculateWO(file) {
    const content = fs.readFileSync(file, 'utf8');
    const dynamic = JSON.parse(content);
    
    let repairList = [];
    if (dynamic.data && dynamic.data.repair_list) {
        repairList = dynamic.data.repair_list;
    } else if (dynamic.repair_list) {
        repairList = dynamic.repair_list;
    }

    const dataObj = dynamic.data || dynamic;
    
    const rootMinApprovalLevel = parseFloatAny(dataObj.min_approval_level);
    const rootStatusAppr = (dataObj.status_approval || "").toLowerCase().trim();
    let isGlobalApproved = false;
    
    if (rootMinApprovalLevel >= 5 || rootStatusAppr === "approved" || rootStatusAppr === "approved level 5") {
        isGlobalApproved = true;
    }

    let latestApprove5Date = "";
    let latestWaitingDate = "";

    function scanDates(items) {
        items.forEach(item => {
            const approvedLevel = parseFloatAny(item.approved_level);
            const statusAppr = (item.status_approval || "").toLowerCase().trim();
            
            let dateToUse = item.date_approval || item.updated_at || item.created_at || "";
            if (!dateToUse && dataObj.updated_at) dateToUse = dataObj.updated_at;
            if (!dateToUse && dataObj.created_at) dateToUse = dataObj.created_at;

            const isAppr5 = approvedLevel >= 5 || statusAppr === "approved" || statusAppr === "approved level 5";
            const isWaiting = approvedLevel === 0 || statusAppr === "waiting";

            if (isAppr5 && dateToUse > latestApprove5Date) latestApprove5Date = dateToUse;
            if (isWaiting && dateToUse > latestWaitingDate) latestWaitingDate = dateToUse;

            if (item.material && item.material.length > 0) {
                scanDates(item.material);
            }
        });
    }
    scanDates(repairList);

    let allowLevel1To4 = false;
    if (latestWaitingDate === "" || latestWaitingDate <= latestApprove5Date) {
        allowLevel1To4 = true;
    }

    let pendingSum = 0;
    let finalCostSum = 0;
    const dailyCosts = {};

    function processItems(items) {
        items.forEach(item => {
            if (item.material && item.material.length > 0) {
                processItems(item.material);
            } else {
                const approvedLevel = parseFloatAny(item.approved_level);
                const statusAppr = (item.status_approval || "").toLowerCase().trim();
                
                let costToAdd = 0;
                let baseCost = parseFloatAny(item.volume_cost_final);
                if (baseCost === 0) baseCost = parseFloatAny(item.price);
                
                if (baseCost > 0) {
                    let vol = 1;
                    if (item.volume !== undefined && item.volume !== null) vol = parseFloatAny(item.volume);
                    costToAdd = baseCost * vol;
                } else {
                    let tPrice = parseFloatAny(item.total_price);
                    if (tPrice > 0) costToAdd = tPrice;
                }

                const isRejected = statusAppr === "rejected";
                const isAppr5 = !isRejected && (approvedLevel >= 5 || statusAppr === "approved" || statusAppr === "approved level 5" || rootMinApprovalLevel >= 5 || rootStatusAppr === "approved" || isGlobalApproved);
                const isLevel1To4 = !isRejected && (approvedLevel >= 1 && approvedLevel <= 4 || statusAppr.startsWith("level") || statusAppr.startsWith("approved level"));
                const isAppr = isAppr5 || (allowLevel1To4 && isLevel1To4);

                if (!isAppr && !isRejected) {
                    pendingSum += costToAdd;
                } else {
                    let dateToUse = item.date_approval || item.updated_at || item.created_at || "";
                    if (!dateToUse && dataObj.updated_at) dateToUse = dataObj.updated_at;
                    if (!dateToUse && dataObj.created_at) dateToUse = dataObj.created_at;

                    if (dateToUse) {
                        const dateOnly = dateToUse.split(" ")[0];
                        dailyCosts[dateOnly] = (dailyCosts[dateOnly] || 0) + costToAdd;
                    }
                    // FIX IS HERE: using isAppr instead of isAppr5
                    if (isAppr) {
                        finalCostSum += costToAdd;
                    }
                }
            }
        });
    }
    processItems(repairList);

    const rootTotalCost = parseFloatAny(dataObj.total_cost);
    if (isGlobalApproved && rootTotalCost > 0) {
        finalCostSum = rootTotalCost;
        pendingSum = 0;
    } else if (pendingSum === 0 && rootTotalCost > 0 && Object.keys(dailyCosts).length === 0) {
        pendingSum = rootTotalCost;
    }

    let latestDate = "";
    let totalDailyCost = 0;
    for (const d in dailyCosts) {
        totalDailyCost += dailyCosts[d];
        if (dailyCosts[d] > 0) {
            if (d > latestDate) latestDate = d;
        }
    }

    let latestCost = 0;
    let previousCost = 0;
    if (latestDate !== "") {
        latestCost = dailyCosts[latestDate];
        previousCost = finalCostSum - latestCost;
    } else {
        latestCost = 0;
        previousCost = finalCostSum;
    }

    console.log("=== HASIL PERHITUNGAN WOXA.json (SETELAH FIX) ===");
    console.log("ID WO            :", dataObj.id);
    console.log("Kode WO          :", dataObj.code);
    console.log("Total dari Root  :", Math.round(rootTotalCost));
    console.log("allowLevel1To4   :", allowLevel1To4);
    console.log("finalCostSum     :", Math.round(finalCostSum));
    console.log("pendingSum       :", Math.round(pendingSum));
    console.log("totalDailyCost   :", Math.round(totalDailyCost));
    console.log("Nilai Sebelumnya :", Math.round(previousCost));
    console.log("Nilai Saat Ini   :", Math.round(latestCost));
    console.log("-----------------------------------");
    console.log("Tanggal Terakhir :", latestDate || "N/A");
}

calculateWO('WOXA.json');
