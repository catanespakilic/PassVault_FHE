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
  website: string;
  username: string;
  encryptedPassword: string;
  publicHint: string;
  timestamp: number;
  creator: string;
  isVerified: boolean;
  decryptedValue?: number;
}

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(true);
  const [passwords, setPasswords] = useState<PasswordEntry[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creatingPassword, setCreatingPassword] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ 
    visible: false, 
    status: "pending", 
    message: "" 
  });
  const [newPasswordData, setNewPasswordData] = useState({ 
    name: "", 
    website: "", 
    username: "", 
    password: "",
    hint: "" 
  });
  const [selectedPassword, setSelectedPassword] = useState<PasswordEntry | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [contractAddress, setContractAddress] = useState("");
  const [fhevmInitializing, setFhevmInitializing] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [stats, setStats] = useState({ total: 0, verified: 0, recent: 0 });

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting } = useEncrypt();
  const { verifyDecryption, isDecrypting: fheIsDecrypting } = useDecrypt();

  useEffect(() => {
    const initFhevmAfterConnection = async () => {
      if (!isConnected || isInitialized || fhevmInitializing) return;
      
      try {
        setFhevmInitializing(true);
        await initialize();
      } catch (error) {
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
            website: businessId,
            username: businessId,
            encryptedPassword: "🔒 FHE Encrypted",
            publicHint: businessData.description,
            timestamp: Number(businessData.timestamp),
            creator: businessData.creator,
            isVerified: businessData.isVerified,
            decryptedValue: Number(businessData.decryptedValue) || 0
          });
        } catch (e) {
          console.error('Error loading business data:', e);
        }
      }
      
      setPasswords(passwordsList);
      setStats({
        total: passwordsList.length,
        verified: passwordsList.filter(p => p.isVerified).length,
        recent: passwordsList.filter(p => Date.now()/1000 - p.timestamp < 604800).length
      });
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Failed to load data" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setIsRefreshing(false); 
    }
  };

  const createPassword = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setCreatingPassword(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Creating password with FHE encryption..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const passwordValue = parseInt(newPasswordData.password) || 0;
      const businessId = `pass-${Date.now()}`;
      
      const encryptedResult = await encrypt(contractAddress, address, passwordValue);
      
      const tx = await contract.createBusinessData(
        businessId,
        newPasswordData.name,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        0,
        0,
        newPasswordData.hint
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Waiting for transaction confirmation..." });
      await tx.wait();
      
      setTransactionStatus({ visible: true, status: "success", message: "Password created successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      await loadData();
      setShowCreateModal(false);
      setNewPasswordData({ name: "", website: "", username: "", password: "", hint: "" });
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected transaction") 
        ? "Transaction rejected by user" 
        : "Submission failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setCreatingPassword(false); 
    }
  };

  const decryptPassword = async (businessId: string): Promise<number | null> => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
    
    setIsDecrypting(true);
    try {
      const contractRead = await getContractReadOnly();
      if (!contractRead) return null;
      
      const businessData = await contractRead.getBusinessData(businessId);
      if (businessData.isVerified) {
        const storedValue = Number(businessData.decryptedValue) || 0;
        setTransactionStatus({ visible: true, status: "success", message: "Password already verified on-chain" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
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
      
      setTransactionStatus({ visible: true, status: "success", message: "Password decrypted and verified!" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
      
      return Number(clearValue);
      
    } catch (e: any) { 
      if (e.message?.includes("Data already verified")) {
        setTransactionStatus({ visible: true, status: "success", message: "Password is already verified" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
        await loadData();
        return null;
      }
      
      setTransactionStatus({ visible: true, status: "error", message: "Decryption failed: " + (e.message || "Unknown error") });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    } finally { 
      setIsDecrypting(false); 
    }
  };

  const filteredPasswords = passwords.filter(password =>
    password.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    password.publicHint.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleIsAvailable = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const result = await contract.isAvailable();
      setTransactionStatus({ visible: true, status: "success", message: "Contract is available!" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Contract call failed" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

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
            <h2>Connect Your Wallet to Continue</h2>
            <p>Please connect your wallet to initialize the encrypted password vault system.</p>
            <div className="connection-steps">
              <div className="step">
                <span>1</span>
                <p>Connect your wallet using the button above</p>
              </div>
              <div className="step">
                <span>2</span>
                <p>FHE system will automatically initialize</p>
              </div>
              <div className="step">
                <span>3</span>
                <p>Start managing your encrypted passwords</p>
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
        <p className="loading-note">This may take a few moments</p>
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
          <p>FHE-based Password Vault</p>
        </div>
        
        <div className="header-actions">
          <button onClick={handleIsAvailable} className="test-btn">
            Test Contract
          </button>
          <button onClick={() => setShowCreateModal(true)} className="create-btn">
            + New Password
          </button>
          <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
        </div>
      </header>
      
      <div className="main-content">
        <div className="stats-panel">
          <div className="stat-item">
            <div className="stat-value">{stats.total}</div>
            <div className="stat-label">Total Passwords</div>
          </div>
          <div className="stat-item">
            <div className="stat-value">{stats.verified}</div>
            <div className="stat-label">Verified</div>
          </div>
          <div className="stat-item">
            <div className="stat-value">{stats.recent}</div>
            <div className="stat-label">Recent</div>
          </div>
        </div>

        <div className="search-section">
          <input
            type="text"
            placeholder="Search passwords..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="search-input"
          />
          <button onClick={loadData} className="refresh-btn" disabled={isRefreshing}>
            {isRefreshing ? "Refreshing..." : "Refresh"}
          </button>
        </div>

        <div className="passwords-list">
          {filteredPasswords.length === 0 ? (
            <div className="no-passwords">
              <p>No passwords found</p>
              <button onClick={() => setShowCreateModal(true)} className="create-btn">
                Create First Password
              </button>
            </div>
          ) : (
            filteredPasswords.map((password, index) => (
              <div 
                className={`password-item ${password.isVerified ? "verified" : ""}`}
                key={index}
                onClick={() => setSelectedPassword(password)}
              >
                <div className="password-header">
                  <div className="password-name">{password.name}</div>
                  <div className={`password-status ${password.isVerified ? "verified" : "encrypted"}`}>
                    {password.isVerified ? "✅ Verified" : "🔒 Encrypted"}
                  </div>
                </div>
                <div className="password-hint">{password.publicHint}</div>
                <div className="password-meta">
                  <span>Created: {new Date(password.timestamp * 1000).toLocaleDateString()}</span>
                  <span>By: {password.creator.substring(0, 6)}...{password.creator.substring(38)}</span>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
      
      {showCreateModal && (
        <ModalCreatePassword 
          onSubmit={createPassword} 
          onClose={() => setShowCreateModal(false)} 
          creating={creatingPassword} 
          passwordData={newPasswordData} 
          setPasswordData={setNewPasswordData}
          isEncrypting={isEncrypting}
        />
      )}
      
      {selectedPassword && (
        <PasswordDetailModal 
          password={selectedPassword} 
          onClose={() => setSelectedPassword(null)} 
          isDecrypting={isDecrypting || fheIsDecrypting} 
          decryptPassword={() => decryptPassword(selectedPassword.id)}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="fhe-spinner"></div>}
              {transactionStatus.status === "success" && <div className="success-icon">✓</div>}
              {transactionStatus.status === "error" && <div className="error-icon">✗</div>}
            </div>
            <div className="transaction-message">{transactionStatus.message}</div>
          </div>
        </div>
      )}

      <footer className="app-footer">
        <div className="footer-content">
          <p>PassVault FHE - Your passwords are encrypted with Fully Homomorphic Encryption</p>
          <div className="fhe-info">
            <span>🔐 FHE Protected | </span>
            <span>抗单点故障 | </span>
            <span>多端同步</span>
          </div>
        </div>
      </footer>
    </div>
  );
};

const ModalCreatePassword: React.FC<{
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  passwordData: any;
  setPasswordData: (data: any) => void;
  isEncrypting: boolean;
}> = ({ onSubmit, onClose, creating, passwordData, setPasswordData, isEncrypting }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    if (name === 'password') {
      const intValue = value.replace(/[^\d]/g, '');
      setPasswordData({ ...passwordData, [name]: intValue });
    } else {
      setPasswordData({ ...passwordData, [name]: value });
    }
  };

  return (
    <div className="modal-overlay">
      <div className="create-password-modal">
        <div className="modal-header">
          <h2>New Password Entry</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice">
            <strong>FHE 🔐 Encryption</strong>
            <p>Password will be encrypted with Zama FHE (Integer only)</p>
          </div>
          
          <div className="form-group">
            <label>Service Name *</label>
            <input 
              type="text" 
              name="name" 
              value={passwordData.name} 
              onChange={handleChange} 
              placeholder="Enter service name..." 
            />
          </div>
          
          <div className="form-group">
            <label>Username *</label>
            <input 
              type="text" 
              name="username" 
              value={passwordData.username} 
              onChange={handleChange} 
              placeholder="Enter username..." 
            />
          </div>
          
          <div className="form-group">
            <label>Password (Integer only) *</label>
            <input 
              type="number" 
              name="password" 
              value={passwordData.password} 
              onChange={handleChange} 
              placeholder="Enter numeric password..." 
              step="1"
              min="0"
            />
            <div className="data-type-label">FHE Encrypted Integer</div>
          </div>
          
          <div className="form-group">
            <label>Hint/Description *</label>
            <input 
              type="text" 
              name="hint" 
              value={passwordData.hint} 
              onChange={handleChange} 
              placeholder="Enter hint or description..." 
            />
            <div className="data-type-label">Public Data</div>
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="cancel-btn">Cancel</button>
          <button 
            onClick={onSubmit} 
            disabled={creating || isEncrypting || !passwordData.name || !passwordData.password || !passwordData.hint} 
            className="submit-btn"
          >
            {creating || isEncrypting ? "Encrypting and Creating..." : "Create Password"}
          </button>
        </div>
      </div>
    </div>
  );
};

const PasswordDetailModal: React.FC<{
  password: PasswordEntry;
  onClose: () => void;
  isDecrypting: boolean;
  decryptPassword: () => Promise<number | null>;
}> = ({ password, onClose, isDecrypting, decryptPassword }) => {
  const [decryptedValue, setDecryptedValue] = useState<number | null>(null);

  const handleDecrypt = async () => {
    if (password.isVerified) {
      setDecryptedValue(password.decryptedValue || null);
      return;
    }
    
    const decrypted = await decryptPassword();
    setDecryptedValue(decrypted);
  };

  return (
    <div className="modal-overlay">
      <div className="password-detail-modal">
        <div className="modal-header">
          <h2>Password Details</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="password-info">
            <div className="info-item">
              <span>Service Name:</span>
              <strong>{password.name}</strong>
            </div>
            <div className="info-item">
              <span>Hint:</span>
              <strong>{password.publicHint}</strong>
            </div>
            <div className="info-item">
              <span>Creator:</span>
              <strong>{password.creator.substring(0, 6)}...{password.creator.substring(38)}</strong>
            </div>
            <div className="info-item">
              <span>Date Created:</span>
              <strong>{new Date(password.timestamp * 1000).toLocaleDateString()}</strong>
            </div>
          </div>
          
          <div className="data-section">
            <h3>Password Data</h3>
            
            <div className="data-row">
              <div className="data-label">Encrypted Password:</div>
              <div className="data-value">
                {password.isVerified || decryptedValue !== null ? 
                  `${password.isVerified ? password.decryptedValue : decryptedValue} (Decrypted)` : 
                  "🔒 FHE Encrypted Integer"
                }
              </div>
              <button 
                className={`decrypt-btn ${(password.isVerified || decryptedValue !== null) ? 'decrypted' : ''}`}
                onClick={handleDecrypt} 
                disabled={isDecrypting}
              >
                {isDecrypting ? "🔓 Decrypting..." : 
                 password.isVerified ? "✅ Verified" : 
                 decryptedValue !== null ? "🔄 Re-decrypt" : "🔓 Decrypt Password"}
              </button>
            </div>
            
            <div className="fhe-info">
              <div className="fhe-icon">🔐</div>
              <div>
                <strong>FHE 🔐 Self-Relaying Decryption</strong>
                <p>Password is encrypted on-chain. Click "Decrypt Password" to perform offline decryption and on-chain verification.</p>
              </div>
            </div>
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="close-btn">Close</button>
        </div>
      </div>
    </div>
  );
};

export default App;