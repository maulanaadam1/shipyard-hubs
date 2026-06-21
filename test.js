const fs = require('fs');
const data = JSON.parse(fs.readFileSync('WOXA.json', 'utf8'));

let sumAll = 0;
let sumAppr5 = 0;
let daily = {};
let itemCosts = [];

function traverse(items) {
  if (!items) return;
  items.forEach(item => {
    // If it's not a group/price node
    if (item.volume_cost_final !== undefined) {
      const cost = parseFloat(item.volume_cost_final);
      sumAll += cost;
      
      const isAppr5 = item.status_approval === 'approved' || item.approved_level >= 5;
      if (isAppr5) {
        sumAppr5 += cost;
        const date = item.date_approval ? item.date_approval.split(' ')[0] : 'null';
        daily[date] = (daily[date] || 0) + cost;
        itemCosts.push({date, cost});
      }
    }
    if (item.material) traverse(item.material);
  });
}

traverse(data.repair_list);
console.log('Total All:', sumAll);
console.log('Total Appr5:', sumAppr5);
console.log('Daily Appr5:', daily);
const dates = Object.keys(daily).sort();
console.log('Latest Date:', dates[dates.length - 1]);
