import React, { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import io from 'socket.io-client';
import './App.css';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || 'http://localhost:4000';

function App() {
  const [items, setItems] = useState([]);
  const [socket, setSocket] = useState(null);
  const [userId] = useState(() => `user_${Math.random().toString(36).substr(2, 9)}`);
  const [serverTimeOffset, setServerTimeOffset] = useState(0);
  const [flashingItems, setFlashingItems] = useState(new Set());
  const [notifications, setNotifications] = useState([]);
  
  const notificationIdRef = useRef(0);

  // Initialize socket connection
  useEffect(() => {
    const newSocket = io(BACKEND_URL);
    setSocket(newSocket);

    // Synchronize with server time
    newSocket.on('SERVER_TIME', (data) => {
      const clientTime = Date.now();
      const offset = data.serverTime - clientTime;
      setServerTimeOffset(offset);
    });

    // Handle bid updates
    newSocket.on('UPDATE_BID', (data) => {
      setItems(prevItems => 
        prevItems.map(item => 
          item.id === data.itemId 
            ? { 
                ...item, 
                currentBid: data.currentBid,
                highestBidder: { id: data.highestBidderId }
              }
            : item
        )
      );
      
      // Flash animation
      setFlashingItems(prev => new Set(prev).add(data.itemId));
      setTimeout(() => {
        setFlashingItems(prev => {
          const next = new Set(prev);
          next.delete(data.itemId);
          return next;
        });
      }, 1000);
    });

    // Handle successful bid
    newSocket.on('BID_SUCCESS', (data) => {
      addNotification('success', `Bid placed successfully: $${data.bidAmount.toLocaleString()}`);
    });

    // Handle outbid notification
    newSocket.on('OUTBID', (data) => {
      addNotification('outbid', `You've been outbid! New bid: $${data.newBid.toLocaleString()}`);
    });

    // Handle bid errors
    newSocket.on('BID_ERROR', (data) => {
      addNotification('error', data.error);
    });

    // Handle auction end
    newSocket.on('AUCTION_ENDED', (data) => {
      setItems(prevItems =>
        prevItems.map(item =>
          item.id === data.itemId
            ? { ...item, hasEnded: true }
            : item
        )
      );
      addNotification('info', `Auction ended for item #${data.itemId}`);
    });

    return () => newSocket.close();
  }, []);

  // Fetch initial items
  useEffect(() => {
    fetch(`${BACKEND_URL}/api/items`)
      .then(res => res.json())
      .then(data => {
        setItems(data.items);
        const offset = data.serverTime - Date.now();
        setServerTimeOffset(offset);
      })
      .catch(err => console.error('Failed to fetch items:', err));
  }, []);

  const addNotification = useCallback((type, message) => {
    const id = ++notificationIdRef.current;
    setNotifications(prev => [...prev, { id, type, message }]);
    setTimeout(() => {
      setNotifications(prev => prev.filter(n => n.id !== id));
    }, 4000);
  }, []);

  const placeBid = useCallback((itemId, currentBid) => {
    if (!socket) return;
    
    const bidAmount = currentBid + 10;
    socket.emit('BID_PLACED', {
      itemId,
      bidAmount,
      userId
    });
  }, [socket, userId]);

  const getServerTime = useCallback(() => {
    return Date.now() + serverTimeOffset;
  }, [serverTimeOffset]);

  return (
    <div className="app">
      {/* Header */}
      <header className="header">
        <div className="header-content">
          <div className="logo">
            <span className="logo-icon">⚡</span>
            <span className="logo-text">VELOCITY</span>
          </div>
          <div className="header-subtitle">LIVE AUCTION PLATFORM</div>
          <div className="user-badge">
            <span className="user-dot"></span>
            <span className="user-id">{userId.slice(0, 8)}</span>
          </div>
        </div>
      </header>

      {/* Notifications */}
      <div className="notifications">
        <AnimatePresence>
          {notifications.map(notif => (
            <motion.div
              key={notif.id}
              className={`notification notification-${notif.type}`}
              initial={{ opacity: 0, y: -20, scale: 0.9 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, x: 100, scale: 0.8 }}
              transition={{ type: 'spring', stiffness: 300, damping: 25 }}
            >
              {notif.message}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* Auction Grid */}
      <main className="main-content">
        <div className="auction-grid">
          {items.map(item => (
            <AuctionCard
              key={item.id}
              item={item}
              userId={userId}
              onBid={placeBid}
              getServerTime={getServerTime}
              isFlashing={flashingItems.has(item.id)}
            />
          ))}
        </div>
      </main>

      {/* Footer */}
      <footer className="footer">
        <div className="footer-content">
          <span>Real-time bidding • Secure transactions • Expert curation</span>
          <span className="footer-divider">•</span>
          <a 
            href="https://www.linkedin.com/in/simhadri-pavan-kumar" 
            target="_blank" 
            rel="noopener noreferrer"
            className="footer-link"
          >
            Built by Pavan Kumar
          </a>
        </div>
      </footer>
    </div>
  );
}

function AuctionCard({ item, userId, onBid, getServerTime, isFlashing }) {
  const [timeLeft, setTimeLeft] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      const serverTime = getServerTime();
      const remaining = Math.max(0, item.auctionEndTime - serverTime);
      setTimeLeft(remaining);
    }, 100);

    return () => clearInterval(interval);
  }, [item.auctionEndTime, getServerTime]);

  const formatTime = (ms) => {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
  };

  const isWinning = item.highestBidder?.id === userId;
  const hasEnded = item.hasEnded || timeLeft === 0;

  return (
    <motion.div
      className={`auction-card ${isFlashing ? 'flashing' : ''} ${isWinning ? 'winning' : ''} ${hasEnded ? 'ended' : ''}`}
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
    >
      <div className="card-image-container">
        <img src={item.imageUrl} alt={item.title} className="card-image" />
        <div className="card-overlay">
          {hasEnded ? (
            <div className="status-badge ended-badge">ENDED</div>
          ) : isWinning ? (
            <motion.div 
              className="status-badge winning-badge"
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: 'spring', stiffness: 300 }}
            >
              ✓ WINNING
            </motion.div>
          ) : null}
        </div>
      </div>

      <div className="card-content">
        <h3 className="card-title">{item.title}</h3>
        <p className="card-description">{item.description}</p>

        <div className="card-stats">
          <div className="stat-group">
            <span className="stat-label">CURRENT BID</span>
            <motion.span 
              className="stat-value"
              key={item.currentBid}
              initial={{ scale: 1.2, color: '#00ff88' }}
              animate={{ scale: 1, color: '#ffffff' }}
              transition={{ duration: 0.3 }}
            >
              ${item.currentBid.toLocaleString()}
            </motion.span>
          </div>

          <div className="stat-group">
            <span className="stat-label">TIME LEFT</span>
            <span className={`stat-value timer ${timeLeft < 30000 ? 'urgent' : ''}`}>
              {hasEnded ? 'ENDED' : formatTime(timeLeft)}
            </span>
          </div>
        </div>

        <button
          className="bid-button"
          onClick={() => onBid(item.id, item.currentBid)}
          disabled={hasEnded}
        >
          {hasEnded ? 'AUCTION ENDED' : `BID +$10`}
        </button>
      </div>
    </motion.div>
  );
}

export default App;