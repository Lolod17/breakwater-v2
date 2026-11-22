// The story spine, told in short on-screen lines. A night-shift courier works for a
// dispatcher, Marlow; a ledger has gone missing from Halden Maritime, whose port
// expansion hides berths for illegal cargo. Two endings, chosen at the jetty.

export const STORY = {
  intro: [
    'Breakwater, 19:42. Night shift starts now.',
    'MARLOW: Courier. Got a job for you. Yellow marker, up the avenue.',
  ],
  missions: [
    {
      title: 'THE PICKUP',
      brief: [
        'MARLOW: One package, old market, no questions asked.',
        'MARLOW: Take any car you like. The stalls close at midnight.',
        'MARLOW: Bring it to the courier depot on the west avenue.',
      ],
      collected: ['A ledger-sized parcel, taped shut with Halden Maritime seals.', 'MARLOW: Don’t open it. Depot. Now.'],
      success: ['MARLOW: Halden Maritime lost their ledger this morning.', 'MARLOW: Someone thinks we have it. Our parcel was a decoy.'],
    },
    {
      title: 'HOT CARGO',
      brief: [
        'MARLOW: Halden wants their crates moved to the warehouse on Customs Row.',
        'MARLOW: Patrols watch that road. Keep under 40 near the watch posts.',
        'MARLOW: Arrive clean. No heat at the drop, or no drop.',
      ],
      tripped: ['WATCH POST: Courier van on Customs Row, running hot.', 'MARLOW: They made you. Shake them before the drop.'],
      success: ['The crates hum. Refrigeration units, in a load of "concrete".', 'MARLOW: The port expansion isn’t building a pier. It’s hiding one.'],
    },
    {
      title: 'NO WITNESSES',
      brief: [
        'MARLOW: A Halden clerk copied half the ledger to a drive.',
        'MARLOW: Grey sedan, heading for the port. Box them in or knock them off the road.',
        'MARLOW: Get that drive before it vanishes into the terminal.',
      ],
      spotted: ['The grey sedan pulls out hard. The clerk has seen you.'],
      stopped: ['The clerk bails out and runs. The drive is still on the seat.', 'MARLOW: Get out and grab it. It wipes itself if it goes offline.'],
      success: ['Berth numbers. Night dates. Signatures from Halden’s board.', 'MARLOW: Half a ledger. The other half is on wheels.'],
    },
    {
      title: 'THE ESCORT',
      brief: [
        'MARLOW: The rest of the ledger rides in a truck through the industrial blocks.',
        'MARLOW: Halden’s crews will try to ram it off the road.',
        'MARLOW: Stay with it. Ram anything that comes for the truck, front or back.',
      ],
      ambush: ['Ambush crew coming up behind the truck!', 'Another crew, dead ahead! Block the oncoming lane!'],
      success: ['The driver presses a key into your hand.', 'DRIVER: Port gate, locker nine. The whole ledger. Don’t look back.'],
    },
    {
      title: 'THE LAST ROUTE',
      brief: [
        'MARLOW: Locker nine at the port gate. This is it.',
        'MARLOW: Halden owns half the patrol cars on the waterfront. Expect company.',
        'MARLOW: Get the ledger to the harbour jetty. Then it’s your call.',
      ],
      gate: ['The ledger: every illegal berth under the expansion, signed.', 'Sirens. Halden called it in, and sent two black sedans of their own.', 'MARLOW: Don’t let them box you. Get to the jetty.'],
      choice: {
        prompt: 'Two boats wait at the jetty. The ledger is in your hands.',
        press: { key: '1', label: 'Give it to the harbour press', reward: 500 },
        deal: { key: '2', label: 'Sell it back to Halden', reward: 2500 },
      },
    },
  ],
  endings: {
    press: {
      title: 'THE TIDE TURNS',
      lines: ['Morning papers: PORT EXPANSION FROZEN. HALDEN BOARD CHARGED.', 'MARLOW: You cost us our best client. I’m proud of you.', 'The cranes stand still over the harbour. For once, the water is quiet.'],
    },
    deal: {
      title: 'QUIET WATER',
      lines: ['Halden’s envelope is heavy. The patrol cars drive away.', 'MARLOW: Nobody will ever know. That’s the point, isn’t it?', 'Out on the breakwater, the cranes keep working all night.'],
    },
  },
};
