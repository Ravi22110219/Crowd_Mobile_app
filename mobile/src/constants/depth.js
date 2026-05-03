export const SCALE_MAX_CM = 200;

export const referenceOptions = [
  { type: 'car', label: 'Car', asset: 'car' },
  { type: 'autorickshaw', label: 'Auto', asset: 'autorickshaw' },
  { type: 'bike', label: 'Bike', asset: 'bike' },
  { type: 'cycle', label: 'Cycle', asset: 'cycle' },
  { type: 'person', label: 'Person', asset: 'person' }
];

export const baseDepthLabels = {
  car: [
    { depth: 0, label: 'No Flood' },
    { depth: 18, label: 'Ground clearance' },
    { depth: 35, label: 'Exhaust / underbody risk' },
    { depth: 60, label: 'Door sill level' },
    { depth: 95, label: 'Window level' },
    { depth: 150, label: 'Roof level' }
  ],
  autorickshaw: [
    { depth: 0, label: 'No Flood' },
    { depth: 15, label: 'Ground clearance' },
    { depth: 35, label: 'Wheel hub level' },
    { depth: 50, label: 'Floor level' },
    { depth: 75, label: 'Seat level' },
    { depth: 165, label: 'Roof level' }
  ],
  bike: [
    { depth: 0, label: 'No Flood' },
    { depth: 15, label: 'Ground clearance' },
    { depth: 45, label: 'Wheel hub level' },
    { depth: 60, label: 'Engine intake risk' },
    { depth: 90, label: 'Seat level' },
    { depth: 125, label: 'Handlebar level' }
  ],
  cycle: [
    { depth: 0, label: 'No Flood' },
    { depth: 10, label: 'Ground level' },
    { depth: 25, label: 'Wheel hub level' },
    { depth: 45, label: 'Pedal level' },
    { depth: 90, label: 'Seat level' },
    { depth: 110, label: 'Handlebar level' }
  ]
};

export const baseReferenceHeights = {
  car: 155,
  autorickshaw: 185,
  bike: 130,
  cycle: 120
};
