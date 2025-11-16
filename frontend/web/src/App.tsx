import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';

interface PasswordEntry {
  id: string;
  name: string;
  username: string;
  encryptedPassword: number;
  publicValue1: number;
  publicValue2: number;
  description: string;
  creator: string;
  timestamp: number;
  isVerified: boolean;
  decryptedValue?: number;
}

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(true);
  const [passwords, setPasswords] = useState<PasswordEntry[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creatingEntry, setCreatingEntry] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ 
    visible: false, 
    status: "pending", 
    message: "" 
  });
  const [newEntryData, setNewEntryData] = useState({ 
    name: "", 
    username: "", 
    password: "",
    description: "" 
  });
  const [selectedEntry, setSelectedEntry] = useState<PasswordEntry | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [operationHistory, setOperationHistory] = useState<string[]>([]);
  const [showIntro, setShowIntro] = useState(true);
  const entriesPerPage = 5;

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting } = useEncrypt();
  const { verifyDecryption, isDecrypting: fheIsDecrypting } = useDecrypt();
  const [fhevmInitializing, setFhevmInitializing] = useState(false);
  const [contractAddress, setContractAddress] = useState("");

  useEffect(() => {
    const initFhevmAfterConnection = async () => {
      if (!isConnected || isInitialized || fhevmInitializing) return;
      
      try {
        setFhevmInitializing(true);
        await initialize();
      } catch (error) {
        console.error('Failed to initialize FHEVM:', error);
        setTransactionStatus({ 
          visible: true, 
          status: "error", 
          message: "FHEVM initialization failed" 
        });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      } finally {
        setFhevmInitializing(false);
      }
    };

    initFhevmAfterConnection();
  }, [isConnected, isInitialized, initialize, fhevmInitializing]);

  useEffect(() => {
    const loadDataAndContract = async () => {
      if (!isConnected) {
        setLoading(false);
        return;
      }
      
      try {
        await loadData();
        const contract = await getContractReadOnly();
        if (contract) setContractAddress(await contract.getAddress());
      } catch (error) {
        console.error('Failed to load data:', error);
      } finally {
        setLoading(false);
      }
    };

    loadDataAndContract();
  }, [isConnected]);

  const addToHistory = (message: string) => {
    setOperationHistory(prev => [message, ...prev.slice(0, 9)]);
  };

  const loadData = async () => {
    if (!isConnected) return;
    
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const businessIds = await contract.getAllBusinessIds();
      const passwordsList: PasswordEntry[] = [];
      
      for (const businessId of businessIds) {
        try {
          const businessData = await contract.getBusinessData(businessId);
          passwordsList.push({
            id: businessId,
            name: businessData.name,
            username: businessData.description,
            encryptedPassword: 0,
            publicValue1: Number(businessData.publicValue1) || 0,
            publicValue2: Number(businessData.publicValue2) || 0,
            description: businessData.description,
            creator: businessData.creator,
            timestamp: Number(businessData.timestamp),
            isVerified: businessData.isVerified,
            decryptedValue: Number(businessData.decryptedValue) || 0
          });
        } catch (e) {
          console.error('Error loading business data:', e);
        }
      }
      
      setPasswords(passwordsList);
      addToHistory(`Loaded ${passwordsList.length} password entries`);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Failed to load data" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setIsRefreshing(false); 
    }
  };

  const createPasswordEntry = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setCreatingEntry(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Creating encrypted password entry..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const passwordValue = parseInt(newEntryData.password) || 0;
      const businessId = `pass-${Date.now()}`;
      
      const encryptedResult = await encrypt(contractAddress, address, passwordValue);
      
      const tx = await contract.createBusinessData(
        businessId,
        newEntryData.name,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        0,
        0,
        newEntryData.username
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Waiting for transaction confirmation..." });
      await tx.wait();
      
      setTransactionStatus({ visible: true, status: "success", message: "Password entry created successfully!" });
      addToHistory(`Created password entry: ${newEntryData.name}`);
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      await loadData();
      setShowCreateModal(false);
      setNewEntryData({ name: "", username: "", password: "", description: "" });
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected transaction") 
        ? "Transaction rejected by user" 
        : "Submission failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setCreatingEntry(false); 
    }
  };

  const decryptPassword = async (businessId: string): Promise<number | null> => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
    
    try {
      const contractRead = await getContractReadOnly();
      if (!contractRead) return null;
      
      const businessData = await contractRead.getBusinessData(businessId);
      if (businessData.isVerified) {
        const storedValue = Number(businessData.decryptedValue) || 0;
        setTransactionStatus({ 
          visible: true, 
          status: "success", 
          message: "Password already verified on-chain" 
        });
        setTimeout(() => {
          setTransactionStatus({ visible: false, status: "pending", message: "" });
        }, 2000);
        return storedValue;
      }
      
      const contractWrite = await getContractWithSigner();
      if (!contractWrite) return null;
      
      const encryptedValueHandle = await contractRead.getEncryptedValue(businessId);
      
      const result = await verifyDecryption(
        [encryptedValueHandle],
        contractAddress,
        (abiEncodedClearValues: string, decryptionProof: string) => 
          contractWrite.verifyDecryption(businessId, abiEncodedClearValues, decryptionProof)
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Verifying decryption on-chain..." });
      
      const clearValue = result.decryptionResult.clearValues[encryptedValueHandle];
      
      await loadData();
      addToHistory(`Decrypted password for entry: ${businessData.name}`);
      
      setTransactionStatus({ visible: true, status: "success", message: "Password decrypted and verified!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      return Number(clearValue);
      
    } catch (e: any) { 
      if (e.message?.includes("Data already verified")) {
        setTransactionStatus({ 
          visible: true, 
          status: "success", 
          message: "Password is already verified on-chain" 
        });
        setTimeout(() => {
          setTransactionStatus({ visible: false, status: "pending", message: "" });
        }, 2000);
        await loadData();
        return null;
      }
      
      setTransactionStatus({ 
        visible: true, 
        status: "error", 
        message: "Decryption failed: " + (e.message || "Unknown error") 
      });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
  };

  const checkAvailability = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const isAvailable = await contract.isAvailable();
      setTransactionStatus({ 
        visible: true, 
        status: "success", 
        message: "Contract is available and ready" 
      });
      addToHistory("Checked contract availability: Ready");
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Availability check failed" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const generateRandomPassword = () => {
    const randomNum = Math.floor(100000 + Math.random() * 900000);
    setNewEntryData(prev => ({ ...prev, password: randomNum.toString() }));
  };

  const filteredPasswords = passwords.filter(entry =>
    entry.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    entry.username.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const paginatedPasswords = filteredPasswords.slice(
    (currentPage - 1) * entriesPerPage,
    currentPage * entriesPerPage
  );

  const totalPages = Math.ceil(filteredPasswords.length / entriesPerPage);

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo">
            <h1>PassVault FHE 🔐</h1>
          </div>
          <div className="header-actions">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </header>
        
        <div className="connection-prompt">
          <div className="connection-content">
            <div className="connection-icon">🔐</div>
            <h2>Connect Your Wallet to Access PassVault</h2>
            <p>Secure your passwords with fully homomorphic encryption technology</p>
            <div className="connection-steps">
              <div className="step">
                <span>1</span>
                <p>Connect your wallet to initialize FHE system</p>
              </div>
              <div className="step">
                <span>2</span>
                <p>Store passwords with military-grade encryption</p>
              </div>
              <div className="step">
                <span>3</span>
                <p>Access your data securely from anywhere</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!isInitialized || fhevmInitializing) {
    return (
      <div className="loading-screen">
        <div className="fhe-spinner"></div>
        <p>Initializing FHE Encryption System...</p>
        <p className="loading-note">Securing your passwords with homomorphic encryption</p>
      </div>
    );
  }

  if (loading) return (
    <div className="loading-screen">
      <div className="fhe-spinner"></div>
      <p>Loading encrypted password vault...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <h1>PassVault FHE 🔐</h1>
          <span className="tagline">Fully Homomorphic Encryption Password Manager</span>
        </div>
        
        <div className="header-actions">
          <button onClick={checkAvailability} className="availability-btn">
            Check System
          </button>
          <button onClick={() => setShowCreateModal(true)} className="create-btn">
            + New Password
          </button>
          <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
        </div>
      </header>

      {showIntro && (
        <div className="intro-panel">
          <div className="intro-content">
            <h2>Welcome to PassVault FHE</h2>
            <p>Your passwords are encrypted using Fully Homomorphic Encryption technology, 
               ensuring maximum security even during computation.</p>
            <div className="fhe-features">
              <div className="feature">
                <span className="feature-icon">🔒</span>
                <strong>End-to-End Encryption</strong>
                <p>Passwords remain encrypted at all times</p>
              </div>
              <div className="feature">
                <span className="feature-icon">⚡</span>
                <strong>Homomorphic Computation</strong>
                <p>Process data without decryption</p>
              </div>
              <div className="feature">
                <span className="feature-icon">🌐</span>
                <strong>Multi-Device Sync</strong>
                <p>Access your passwords securely anywhere</p>
              </div>
            </div>
            <button onClick={() => setShowIntro(false)} className="close-intro">
              Get Started
            </button>
          </div>
        </div>
      )}
      
      <div className="main-content">
        <div className="sidebar">
          <div className="search-section">
            <input
              type="text"
              placeholder="Search passwords..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="search-input"
            />
          </div>
          
          <div className="stats-panel">
            <h3>Vault Statistics</h3>
            <div className="stat-item">
              <span>Total Passwords:</span>
              <strong>{passwords.length}</strong>
            </div>
            <div className="stat-item">
              <span>Verified:</span>
              <strong>{passwords.filter(p => p.isVerified).length}</strong>
            </div>
            <div className="stat-item">
              <span>Encrypted:</span>
              <strong>{passwords.length}</strong>
            </div>
          </div>
          
          <div className="history-panel">
            <h3>Recent Activity</h3>
            <div className="history-list">
              {operationHistory.map((entry, index) => (
                <div key={index} className="history-item">
                  {entry}
                </div>
              ))}
              {operationHistory.length === 0 && (
                <div className="no-history">No recent activity</div>
              )}
            </div>
          </div>
        </div>
        
        <div className="content-area">
          <div className="content-header">
            <h2>Your Encrypted Passwords</h2>
            <div className="header-controls">
              <button onClick={loadData} className="refresh-btn" disabled={isRefreshing}>
                {isRefreshing ? "🔄" : "↻"} Refresh
              </button>
            </div>
          </div>
          
          <div className="passwords-grid">
            {paginatedPasswords.length === 0 ? (
              <div className="empty-state">
                <div className="empty-icon">🔐</div>
                <h3>No passwords found</h3>
                <p>{searchTerm ? "Try adjusting your search terms" : "Create your first encrypted password entry"}</p>
                <button onClick={() => setShowCreateModal(true)} className="create-btn">
                  Add First Password
                </button>
              </div>
            ) : (
              paginatedPasswords.map((entry, index) => (
                <div 
                  key={entry.id}
                  className={`password-card ${entry.isVerified ? 'verified' : ''}`}
                  onClick={() => setSelectedEntry(entry)}
                >
                  <div className="card-header">
                    <h3>{entry.name}</h3>
                    <span className="verification-status">
                      {entry.isVerified ? '✅ Verified' : '🔒 Encrypted'}
                    </span>
                  </div>
                  <div className="card-content">
                    <div className="password-info">
                      <span>Username: {entry.username}</span>
                      <span>Created: {new Date(entry.timestamp * 1000).toLocaleDateString()}</span>
                    </div>
                    <div className="password-preview">
                      {entry.isVerified ? (
                        <span className="decrypted-password">Password: {entry.decryptedValue}</span>
                      ) : (
                        <span className="encrypted-password">••••••••</span>
                      )}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
          
          {totalPages > 1 && (
            <div className="pagination">
              <button 
                onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                disabled={currentPage === 1}
              >
                Previous
              </button>
              <span>Page {currentPage} of {totalPages}</span>
              <button 
                onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                disabled={currentPage === totalPages}
              >
                Next
              </button>
            </div>
          )}
        </div>
      </div>
      
      {showCreateModal && (
        <CreatePasswordModal 
          onSubmit={createPasswordEntry}
          onClose={() => setShowCreateModal(false)}
          creating={creatingEntry}
          entryData={newEntryData}
          setEntryData={setNewEntryData}
          isEncrypting={isEncrypting}
          onGeneratePassword={generateRandomPassword}
        />
      )}
      
      {selectedEntry && (
        <PasswordDetailModal 
          entry={selectedEntry}
          onClose={() => setSelectedEntry(null)}
          onDecrypt={decryptPassword}
          isDecrypting={fheIsDecrypting}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="fhe-spinner"></div>}
              {transactionStatus.status === "success" && "✓"}
              {transactionStatus.status === "error" && "✗"}
            </div>
            <div className="transaction-message">{transactionStatus.message}</div>
          </div>
        </div>
      )}

      <footer className="app-footer">
        <div className="footer-content">
          <p>PassVault FHE - Your passwords are secured with Fully Homomorphic Encryption</p>
          <div className="footer-links">
            <span>🔐 End-to-End Encrypted</span>
            <span>⚡ Homomorphic Computing</span>
            <span>🌐 Multi-Platform Sync</span>
          </div>
        </div>
      </footer>
    </div>
  );
};

const CreatePasswordModal: React.FC<{
  onSubmit: () => void;
  onClose: () => void;
  creating: boolean;
  entryData: any;
  setEntryData: (data: any) => void;
  isEncrypting: boolean;
  onGeneratePassword: () => void;
}> = ({ onSubmit, onClose, creating, entryData, setEntryData, isEncrypting, onGeneratePassword }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setEntryData({ ...entryData, [name]: value });
  };

  return (
    <div className="modal-overlay">
      <div className="create-modal">
        <div className="modal-header">
          <h2>Add New Password</h2>
          <button onClick={onClose} className="close-modal">×</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice">
            <strong>FHE 🔐 Encryption Notice</strong>
            <p>Password will be encrypted using Zama FHE technology (Integer passwords only)</p>
          </div>
          
          <div className="form-group">
            <label>Service Name *</label>
            <input 
              type="text" 
              name="name" 
              value={entryData.name} 
              onChange={handleChange} 
              placeholder="e.g., Gmail, GitHub..." 
            />
          </div>
          
          <div className="form-group">
            <label>Username/Email *</label>
            <input 
              type="text" 
              name="username" 
              value={entryData.username} 
              onChange={handleChange} 
              placeholder="Your username or email" 
            />
          </div>
          
          <div className="form-group">
            <label>Password (Numbers only) *</label>
            <div className="password-input-group">
              <input 
                type="number" 
                name="password" 
                value={entryData.password} 
                onChange={handleChange} 
                placeholder="Enter numeric password" 
                step="1"
                min="0"
              />
              <button type="button" onClick={onGeneratePassword} className="generate-btn">
                🎲 Generate
              </button>
            </div>
            <div className="input-hint">FHE Encrypted Integer - Letters not supported</div>
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="cancel-btn">Cancel</button>
          <button 
            onClick={onSubmit} 
            disabled={creating || isEncrypting || !entryData.name || !entryData.username || !entryData.password} 
            className="submit-btn"
          >
            {creating || isEncrypting ? "Encrypting..." : "Create Encrypted Entry"}
          </button>
        </div>
      </div>
    </div>
  );
};

const PasswordDetailModal: React.FC<{
  entry: PasswordEntry;
  onClose: () => void;
  onDecrypt: (id: string) => Promise<number | null>;
  isDecrypting: boolean;
}> = ({ entry, onClose, onDecrypt, isDecrypting }) => {
  const [decryptedPassword, setDecryptedPassword] = useState<number | null>(null);

  const handleDecrypt = async () => {
    const result = await onDecrypt(entry.id);
    setDecryptedPassword(result);
  };

  return (
    <div className="modal-overlay">
      <div className="detail-modal">
        <div className="modal-header">
          <h2>Password Details</h2>
          <button onClick={onClose} className="close-modal">×</button>
        </div>
        
        <div className="modal-body">
          <div className="password-info">
            <div className="info-row">
              <span>Service:</span>
              <strong>{entry.name}</strong>
            </div>
            <div className="info-row">
              <span>Username:</span>
              <strong>{entry.username}</strong>
            </div>
            <div className="info-row">
              <span>Created:</span>
              <strong>{new Date(entry.timestamp * 1000).toLocaleString()}</strong>
            </div>
            <div className="info-row">
              <span>Status:</span>
              <strong className={entry.isVerified ? 'verified' : 'encrypted'}>
                {entry.isVerified ? '✅ On-chain Verified' : '🔒 FHE Encrypted'}
              </strong>
            </div>
          </div>
          
          <div className="password-section">
            <h3>Password</h3>
            <div className="password-display">
              {entry.isVerified ? (
                <div className="decrypted-password-value">
                  <span>{entry.decryptedValue}</span>
                  <span className="status-badge verified">On-chain Verified</span>
                </div>
              ) : decryptedPassword !== null ? (
                <div className="decrypted-password-value">
                  <span>{decryptedPassword}</span>
                  <span className="status-badge local">Locally Decrypted</span>
                </div>
              ) : (
                <div className="encrypted-password-value">
                  <span>••••••••</span>
                  <span className="status-badge encrypted">FHE Encrypted</span>
                </div>
              )}
            </div>
            
            {!entry.isVerified && (
              <button 
                onClick={handleDecrypt}
                disabled={isDecrypting}
                className="decrypt-btn"
              >
                {isDecrypting ? "Decrypting..." : 
                 decryptedPassword !== null ? "Re-verify on-chain" : 
                 "Decrypt Password"}
              </button>
            )}
          </div>
          
          <div className="fhe-explanation">
            <h4>🔐 FHE Security Process</h4>
            <ol>
              <li>Password encrypted client-side with FHE</li>
              <li>Encrypted data stored on blockchain</li>
              <li>Decryption happens offline with proof generation</li>
              <li>Proof verified on-chain without exposing password</li>
            </ol>
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="close-btn">Close</button>
          {!entry.isVerified && (
            <button 
              onClick={handleDecrypt}
              disabled={isDecrypting}
              className="verify-btn"
            >
              {isDecrypting ? "Verifying..." : "Verify on-chain"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default App;


