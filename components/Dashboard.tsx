'use client';

import React from 'react';
import StatsOverview from './StatsOverview';
import FleetStatusChart from './charts/FleetStatusChart';
import MaintenanceScheduleChart from './charts/MaintenanceScheduleChart';
import EquipmentUtilizationChart from './charts/EquipmentUtilizationChart';
import ActiveRepairsQueue from './ActiveRepairsQueue';
import RepairHistoryChart from './charts/RepairHistoryChart';
import { motion } from 'motion/react';

const container = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: {
      staggerChildren: 0.1
    }
  }
};

const item = {
  hidden: { y: 20, opacity: 0 },
  show: { y: 0, opacity: 1 }
};

export default function Dashboard() {
  return (
    <motion.div 
      variants={container}
      initial="hidden"
      animate="show"
      className="p-8"
    >
      <motion.div variants={item}>
        <StatsOverview />
      </motion.div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <motion.div variants={item} className="h-[450px]">
          <FleetStatusChart />
        </motion.div>
        
        <motion.div variants={item} className="h-[450px]">
          <EquipmentUtilizationChart />
        </motion.div>

        <motion.div variants={item} className="h-[450px]">
          <MaintenanceScheduleChart />
        </motion.div>
        
        <motion.div variants={item} className="h-[450px]">
          <ActiveRepairsQueue />
        </motion.div>
        
        <motion.div variants={item} className="h-[450px]">
          <RepairHistoryChart />
        </motion.div>
      </div>
    </motion.div>
  );
}
