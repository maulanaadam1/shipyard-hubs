'use client';

import React from 'react';
import ShipProjectGanttChart from './charts/ShipProjectGanttChart';
import { motion } from 'motion/react';

export default function Dashboard() {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.25 }}
      className="p-6 flex flex-col"
      style={{ height: 'calc(100vh - 64px)' }}
    >
      <div className="flex-1 min-h-0">
        <ShipProjectGanttChart />
      </div>
    </motion.div>
  );
}
