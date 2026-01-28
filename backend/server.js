const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*", // Allow all origins for production
    methods: ["GET", "POST"]
  }
});

app.use(cors());
app.use(express.json());

// In-memory data store (use Redis/DB in production)
const auctionItems = [
  {
    id: 1,
    title: "Vintage Rolex Submariner",
    description: "1960s classic dive watch in pristine condition",
    imageUrl: "https://images.unsplash.com/photo-1523170335258-f5ed11844a49?w=400",
    startingPrice: 5000,
    currentBid: 5000,
    highestBidder: null,
    auctionEndTime: Date.now() + 180000, // 3 minutes from now
    bids: []
  },
  {
    id: 2,
    title: "MacBook Pro M3 Max",
    description: "16-inch, 64GB RAM, 2TB SSD - Brand New",
    imageUrl: "https://images.unsplash.com/photo-1517336714731-489689fd1ca8?w=400",
    startingPrice: 2500,
    currentBid: 2500,
    highestBidder: null,
    auctionEndTime: Date.now() + 240000, // 4 minutes
    bids: []
  },
  {
    id: 3,
    title: "Rare Pokémon Card Set",
    description: "1st Edition Base Set - Complete Collection",
    imageUrl: "https://images.unsplash.com/photo-1606503153255-59d440e8dbc8?w=400",
    startingPrice: 10000,
    currentBid: 10000,
    highestBidder: null,
    auctionEndTime: Date.now() + 300000, // 5 minutes
    bids: []
  },
  {
    id: 4,
    title: "Gibson Les Paul 1959",
    description: "Holy Grail of electric guitars",
    imageUrl: "https://images.unsplash.com/photo-1564186763535-ebb21ef5277f?w=400",
    startingPrice: 150000,
    currentBid: 150000,
    highestBidder: null,
    auctionEndTime: Date.now() + 360000, // 6 minutes
    bids: []
  },
  {
    id: 5,
    title: "iPhone 15 Pro Max 1TB",
    description: "Sealed box, Titanium Blue",
    imageUrl: "https://images.unsplash.com/photo-1592286927505-2fd1eb8b76c5?w=400",
    startingPrice: 800,
    currentBid: 800,
    highestBidder: null,
    auctionEndTime: Date.now() + 150000, // 2.5 minutes
    bids: []
  },
  {
    id: 6,
    title: "Tesla Model S Plaid",
    description: "2023, 5000 miles, Full Self-Driving",
    imageUrl: "https://images.unsplash.com/photo-1560958089-b8a1929cea89?w=400",
    startingPrice: 75000,
    currentBid: 75000,
    highestBidder: null,
    auctionEndTime: Date.now() + 420000, // 7 minutes
    bids: []
  }
];

// Mutex-like lock mechanism to prevent race conditions
const itemLocks = new Map();

/**
 * Acquire a lock for a specific item
 * Returns a promise that resolves when the lock is acquired
 */
async function acquireLock(itemId) {
  while (itemLocks.get(itemId)) {
    // Wait for 1ms before checking again
    await new Promise(resolve => setTimeout(resolve, 1));
  }
  itemLocks.set(itemId, true);
}

/**
 * Release the lock for a specific item
 */
function releaseLock(itemId) {
  itemLocks.delete(itemId);
}

/**
 * Process a bid with proper concurrency control
 */
async function processBid(itemId, bidAmount, bidderId, socketId) {
  // Acquire lock to prevent race conditions
  await acquireLock(itemId);
  
  try {
    const item = auctionItems.find(i => i.id === itemId);
    
    if (!item) {
      return { success: false, error: 'Item not found' };
    }
    
    // Check if auction has ended
    const currentTime = Date.now();
    if (currentTime >= item.auctionEndTime) {
      return { success: false, error: 'Auction has ended' };
    }
    
    // Check if bid is higher than current bid
    if (bidAmount <= item.currentBid) {
      return { 
        success: false, 
        error: 'Bid must be higher than current bid',
        currentBid: item.currentBid
      };
    }
    
    // Accept the bid
    const previousBid = item.currentBid;
    const previousBidder = item.highestBidder;
    
    item.currentBid = bidAmount;
    item.highestBidder = {
      id: bidderId,
      socketId: socketId
    };
    
    item.bids.push({
      amount: bidAmount,
      bidderId,
      timestamp: currentTime
    });
    
    return { 
      success: true, 
      item: {
        id: item.id,
        currentBid: item.currentBid,
        highestBidder: item.highestBidder,
        previousBid,
        previousBidder
      }
    };
    
  } finally {
    // Always release the lock
    releaseLock(itemId);
  }
}

// REST API endpoints
app.get('/api/items', (req, res) => {
  const currentTime = Date.now();
  
  const itemsData = auctionItems.map(item => ({
    id: item.id,
    title: item.title,
    description: item.description,
    imageUrl: item.imageUrl,
    startingPrice: item.startingPrice,
    currentBid: item.currentBid,
    highestBidder: item.highestBidder ? {
      id: item.highestBidder.id
      // Don't expose socketId to clients
    } : null,
    auctionEndTime: item.auctionEndTime,
    hasEnded: currentTime >= item.auctionEndTime,
    bidCount: item.bids.length
  }));
  
  res.json({
    items: itemsData,
    serverTime: currentTime
  });
});

app.get('/api/server-time', (req, res) => {
  res.json({ serverTime: Date.now() });
});

// Socket.io connection handling
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);
  
  // Send initial server time for synchronization
  socket.emit('SERVER_TIME', { serverTime: Date.now() });
  
  // Handle bid placement
  socket.on('BID_PLACED', async (data) => {
    const { itemId, bidAmount, userId } = data;
    
    console.log(`Bid received: Item ${itemId}, Amount ${bidAmount}, User ${userId}`);
    
    // Process bid with concurrency control
    const result = await processBid(itemId, bidAmount, userId, socket.id);
    
    if (result.success) {
      // Broadcast the new bid to ALL clients
      io.emit('UPDATE_BID', {
        itemId: result.item.id,
        currentBid: result.item.currentBid,
        highestBidderId: result.item.highestBidder.id,
        timestamp: Date.now()
      });
      
      // Send success confirmation to the bidder
      socket.emit('BID_SUCCESS', {
        itemId: result.item.id,
        bidAmount: result.item.currentBid
      });
      
      // Notify the previous bidder they were outbid
      if (result.item.previousBidder && result.item.previousBidder.socketId) {
        io.to(result.item.previousBidder.socketId).emit('OUTBID', {
          itemId: result.item.id,
          yourBid: result.item.previousBid,
          newBid: result.item.currentBid
        });
      }
      
    } else {
      // Send error to the bidder
      socket.emit('BID_ERROR', {
        itemId,
        error: result.error,
        currentBid: result.currentBid
      });
    }
  });
  
  // Handle auction end notifications
  const checkAuctionEnds = setInterval(() => {
    const currentTime = Date.now();
    
    auctionItems.forEach(item => {
      if (currentTime >= item.auctionEndTime && !item.ended) {
        item.ended = true;
        io.emit('AUCTION_ENDED', {
          itemId: item.id,
          finalBid: item.currentBid,
          winnerId: item.highestBidder ? item.highestBidder.id : null
        });
      }
    });
  }, 1000);
  
  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
    clearInterval(checkAuctionEnds);
  });
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: Date.now() });
});

const PORT = process.env.PORT || 4000;

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Auction items initialized: ${auctionItems.length}`);
});
