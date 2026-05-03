'use client';

import React from 'react';
import StatsOverview from './StatsOverview';
import ShipProjectGanttChart from './charts/ShipProjectGanttChart';
import { motion } from 'motion/react';

const container = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.1 } }
};

const item = {
  hidden: { y: 20, opacity: 0 },
  show: { y: 0, opacity: 1 }
};

export default function Dashboard() {
  return (
    <motion.div variants={container} initial="hidden" animate="show" className="p-8 space-y-8">
      <motion.div variants={item}>
        <StatsOverview />
      </motion.div>

      <motion.div variants={item} style={{ height: 640 }}>
        <ShipProjectGanttChart />
      </motion.div>
    </motion.div>
  );
}
