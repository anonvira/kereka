import { useState, useEffect, createContext, useContext } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, onAuthStateChanged, signOut, signInAnonymously } from 'firebase/auth';
import { getFirestore, doc, setDoc, getDoc, collection, query, where, onSnapshot, updateDoc, deleteDoc } from 'firebase/firestore';

// Set the admin email address here.
const ADMIN_EMAIL = 'anonviranon@gmail.com';

// Main application component
const App = () => {
  // Use state to manage the app's core data
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState(null);
  const [userData, setUserData] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isGuest, setIsGuest] = useState(false);
  const [view, setView] = useState('dashboard');
  const [announcements, setAnnouncements] = useState([]);
  const [activities, setActivities] = useState([]);
  const [gallery, setGallery] = useState([]);
  const [pendingUsers, setPendingUsers] = useState([]);
  const [message, setMessage] = useState('');
  const [messageType, setMessageType] = useState('success');

  // Firestore and Auth instances
  const [db, setDb] = useState(null);
  const [auth, setAuth] = useState(null);

  // Constants from the environment
  const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
  const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {};
  const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;

  // Effect to initialize Firebase and handle authentication
  useEffect(() => {
    const initFirebase = async () => {
      try {
        if (Object.keys(firebaseConfig).length === 0) {
          console.error("Firebase config is missing. Please provide it.");
          return;
        }

        const app = initializeApp(firebaseConfig);
        const firestore = getFirestore(app);
        const authInstance = getAuth(app);
        setDb(firestore);
        setAuth(authInstance);

        // Sign in with the provided custom token if available, otherwise sign in anonymously
        if (initialAuthToken) {
          await signInWithCustomToken(authInstance, initialAuthToken);
        } else {
          await signInAnonymously(authInstance);
        }

        // Listen for authentication state changes
        const unsubscribe = onAuthStateChanged(authInstance, async (currentUser) => {
          setUser(currentUser);
          if (currentUser) {
            // Check if the user is registered in the database
            const userDocRef = doc(firestore, `artifacts/${appId}/users/${currentUser.uid}/userData/profile`);
            const userDocSnap = await getDoc(userDocRef);

            if (userDocSnap.exists()) {
              const userDataFromDb = userDocSnap.data();
              setUserData(userDataFromDb);
            } else {
              setUserData(null); // Not a registered user
            }
          } else {
            setUserData(null); // User logged out
          }
          setLoading(false);
        });

        // Cleanup the listener on component unmount
        return () => unsubscribe();
      } catch (e) {
        console.error("Failed to initialize Firebase:", e);
        setLoading(false);
      }
    };

    initFirebase();
  }, [appId, firebaseConfig, initialAuthToken]);

  // Effect to check for admin status when the user changes
  useEffect(() => {
    // This is the production logic for admin access.
    if (user && user.email === ADMIN_EMAIL) {
      setIsAdmin(true);
    } else {
      setIsAdmin(false);
    }
  }, [user]);

  // Effect to fetch public dashboard data and user-specific data
  useEffect(() => {
    if (!db || (!user && !isGuest)) return;

    // Listen for announcements
    const announcementsRef = collection(db, `artifacts/${appId}/public/data/announcements`);
    const unsubscribeAnnouncements = onSnapshot(announcementsRef, (snapshot) => {
      const announcementsData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setAnnouncements(announcementsData);
    });

    // Listen for activities
    const activitiesRef = collection(db, `artifacts/${appId}/public/data/activities`);
    const unsubscribeActivities = onSnapshot(activitiesRef, (snapshot) => {
      const activitiesData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setActivities(activitiesData);
    });

    // Listen for gallery photos
    const galleryRef = collection(db, `artifacts/${appId}/public/data/gallery`);
    const unsubscribeGallery = onSnapshot(galleryRef, (snapshot) => {
      const galleryData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setGallery(galleryData);
    });

    // If the user is an admin, listen for pending users
    if (isAdmin) {
      const pendingUsersRef = collection(db, `artifacts/${appId}/users`);
      const q = query(pendingUsersRef, where('userData.profile.status', '==', 'pending'));
      const unsubscribePending = onSnapshot(q, (snapshot) => {
        const pendingUsersData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data().userData.profile, uid: doc.id }));
        setPendingUsers(pendingUsersData);
      });
      return () => {
        unsubscribeAnnouncements();
        unsubscribeActivities();
        unsubscribeGallery();
        unsubscribePending();
      };
    }

    // Cleanup listeners
    return () => {
      unsubscribeAnnouncements();
      unsubscribeActivities();
      unsubscribeGallery();
    };
  }, [db, user, isGuest, isAdmin, appId]);

  // Function to show a temporary message
  const showMessage = (msg, type) => {
    setMessage(msg);
    setMessageType(type);
    setTimeout(() => {
      setMessage('');
    }, 5000); // Message disappears after 5 seconds
  };

  // Handle Google Sign-In
  const handleGoogleSignIn = async () => {
    if (!auth) {
      showMessage("Authentication service not available.", "error");
      return;
    }
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(auth, provider);
    } catch (error) {
      console.error("Google sign-in error:", error);
      showMessage("Failed to sign in with Google.", "error");
    }
  };

  // Handle user registration
  const handleSignup = async (identificationNumber, receiptUrl) => {
    if (!user || !db) return;

    const userDocRef = doc(db, `artifacts/${appId}/users/${user.uid}/userData/profile`);
    try {
      // Check if user already exists to prevent re-registration
      const userDocSnap = await getDoc(userDocRef);
      if (userDocSnap.exists()) {
        showMessage("You are already registered.", "error");
        return;
      }

      await setDoc(userDocRef, {
        name: user.displayName,
        email: user.email,
        identificationNumber,
        receiptUrl,
        status: 'pending', // Awaiting admin approval
        isAdmin: false,
        registeredAt: new Date().toISOString()
      });
      showMessage("Registration submitted successfully. Awaiting admin approval.", "success");
      setUserData({
        name: user.displayName,
        email: user.email,
        identificationNumber,
        receiptUrl,
        status: 'pending'
      });
    } catch (e) {
      console.error("Error during registration:", e);
      showMessage("Error during registration.", "error");
    }
  };

  // Handle admin approval
  const approveUser = async (uid) => {
    if (!db || !isAdmin) return;
    const userDocRef = doc(db, `artifacts/${appId}/users/${uid}/userData/profile`);
    try {
      await updateDoc(userDocRef, {
        status: 'active'
      });
      showMessage(`User ${uid} approved successfully.`, "success");
    } catch (e) {
      console.error("Error approving user:", e);
      showMessage("Error approving user.", "error");
    }
  };

  // Handle admin deletion
  const deleteUser = async (uid) => {
    if (!db || !isAdmin) return;
    const userDocRef = doc(db, `artifacts/${appId}/users/${uid}/userData/profile`);
    try {
      await deleteDoc(userDocRef);
      showMessage(`User ${uid} deleted successfully.`, "success");
    } catch (e) {
      console.error("Error deleting user:", e);
      showMessage("Error deleting user.", "error");
    }
  };

  // Component to render the message box
  const MessageBox = ({ message, type }) => {
    if (!message) return null;
    const bgColor = type === 'success' ? 'bg-green-500' : 'bg-red-500';
    return (
      <div className={`fixed top-4 left-1/2 -translate-x-1/2 px-6 py-3 rounded-lg text-white shadow-lg ${bgColor} z-50`}>
        {message}
      </div>
    );
  };

  // Loading state
  if (loading) {
    return (
      <div className="flex justify-center items-center h-screen bg-gray-100">
        <div className="text-xl font-semibold text-gray-700 animate-pulse">Loading...</div>
      </div>
    );
  }

  // --- Main UI Components ---
  const Header = () => (
    <header className="flex justify-between items-center p-4 bg-gray-800 text-white shadow-md">
      <h1 className="text-2xl font-bold">Membership Dashboard</h1>
      <nav>
        {user ? (
          <button
            onClick={() => {
              signOut(auth);
              setIsGuest(false);
            }}
            className="px-4 py-2 bg-red-600 rounded-lg shadow-md hover:bg-red-700 transition-colors"
          >
            Logout
          </button>
        ) : (
          <div className="flex space-x-2">
            {!isGuest && (
              <button
                onClick={handleGoogleSignIn}
                className="px-4 py-2 bg-blue-600 rounded-lg shadow-md hover:bg-blue-700 transition-colors"
              >
                Login
              </button>
            )}
            <button
              onClick={() => setIsGuest(false)}
              className="px-4 py-2 bg-gray-600 rounded-lg shadow-md hover:bg-gray-700 transition-colors"
              >
              Back
            </button>
          </div>
        )}
      </nav>
    </header>
  );

  const ExpiredBanner = () => (
    <div className="bg-red-500 text-white text-center py-2 font-semibold">
      Your membership has expired. Please renew to regain full access.
    </div>
  );

  const LoginView = ({ setIsGuest }) => (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gray-100">
      <div className="p-8 bg-white rounded-xl shadow-lg text-center">
        <h2 className="text-2xl font-bold text-gray-800 mb-4">Welcome</h2>
        <p className="text-gray-600 mb-6">Please log in to continue or view public content as a guest.</p>
        <div className="space-y-4">
          <button
            onClick={handleGoogleSignIn}
            className="w-full py-3 px-6 bg-blue-600 text-white rounded-lg shadow-lg hover:bg-blue-700 transition-colors flex items-center justify-center space-x-2"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-google"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="4"/><path d="M21.1 12.5c-.11-.45-.22-.9-.35-1.35C19.8 11.2 18.5 10 17 10c-1.5 0-2.8 1.2-3.3 2.7-.2.6-.3 1.2-.3 1.8-.2 1.4-.2 2.8-.2 4.2 0 .5.4 1 .9 1h.2c.5 0 .9-.4.9-1-.1-1.4-.1-2.8-.1-4.2-.1-.8.2-1.6.8-2.2.4-.4.8-.6 1.3-.6.5 0 1 .2 1.4.6.4.4.6.8.6 1.3 0 .5-.2 1-.6 1.4-.4.4-.8.6-1.3.6-.5 0-1 .2-1.4.6-.4.4-.6.8-.6 1.3 0 .5.2 1 .6 1.4.4.4.8.6 1.3.6.5 0 1-.2 1.4-.6.4-.4.6-.8.6-1.3-.1-.5-.2-1-.4-1.5.1-.4.2-.8.3-1.2.1-.4.2-.8.3-1.2h.1c.5 0 .9-.4.9-1v-.2c0-.5-.4-.9-.9-.9zM12 21c-4.97 0-9-4.03-9-9s4.03-9 9-9 9 4.03 9 9-4.03 9-9 9z"/></svg>
            <span>Login with Google</span>
          </button>
          <button
            onClick={() => setIsGuest(true)}
            className="w-full py-3 px-6 bg-gray-500 text-white rounded-lg shadow-lg hover:bg-gray-600 transition-colors"
          >
            Continue as Guest
          </button>
        </div>
      </div>
    </div>
  );

  const SignupView = () => {
    const [identificationNumber, setIdentificationNumber] = useState('');
    const [receiptUrl, setReceiptUrl] = useState('');

    const handleSubmit = (e) => {
      e.preventDefault();
      if (identificationNumber && receiptUrl) {
        handleSignup(identificationNumber, receiptUrl);
      } else {
        showMessage("Please fill out all fields.", "error");
      }
    };

    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-gray-100 p-4">
        <div className="w-full max-w-lg p-8 bg-white rounded-xl shadow-lg">
          <h2 className="text-2xl font-bold text-gray-800 mb-4 text-center">Member Signup</h2>
          <p className="text-gray-600 mb-6 text-center">Welcome, {user.displayName}! Please complete your signup.</p>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="id-number" className="block text-sm font-medium text-gray-700">Identification Number</label>
              <input
                type="text"
                id="id-number"
                value={identificationNumber}
                onChange={(e) => setIdentificationNumber(e.target.value)}
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring focus:ring-blue-500 focus:ring-opacity-50 p-2 border"
                placeholder="Enter your ID number"
              />
            </div>
            <div>
              <label htmlFor="receipt" className="block text-sm font-medium text-gray-700">Proof of Payment (URL)</label>
              <input
                type="text"
                id="receipt"
                value={receiptUrl}
                onChange={(e) => setReceiptUrl(e.target.value)}
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring focus:ring-blue-500 focus:ring-opacity-50 p-2 border"
                placeholder="Paste receipt or QR URL"
              />
            </div>
            <button
              type="submit"
              className="w-full py-3 px-6 bg-green-600 text-white rounded-lg shadow-lg hover:bg-green-700 transition-colors font-semibold"
            >
              Submit for Approval
            </button>
          </form>
          {userData && userData.status === 'pending' && (
            <p className="mt-4 text-center text-yellow-600 font-medium">Your registration is pending approval.</p>
          )}
        </div>
      </div>
    );
  };

  const DashboardView = () => {
    const sections = [
      { id: 'announcements', title: 'Announcements', data: announcements, icon: "📢" },
      { id: 'activities', title: 'Activities', data: activities, icon: "🗓️" },
      { id: 'gallery', title: 'Photo Gallery', data: gallery, icon: "📸" },
    ];

    const renderSection = () => {
      const section = sections.find(s => s.id === view);
      if (!section) return null;

      return (
        <div className="bg-white p-6 rounded-xl shadow-lg min-h-[500px]">
          <h2 className="text-3xl font-bold text-gray-800 mb-6 flex items-center space-x-2">
            <span>{section.icon}</span>
            <span>{section.title}</span>
          </h2>
          {section.data.length > 0 ? (
            <div className="space-y-6">
              {section.data.map(item => (
                <div key={item.id} className="p-4 border border-gray-200 rounded-lg shadow-sm bg-gray-50">
                  <h3 className="text-xl font-semibold text-gray-800">{item.title}</h3>
                  <p className="mt-2 text-gray-600">{item.description}</p>
                  {item.imageUrl && (
                    <img src={item.imageUrl} alt={item.title} className="mt-4 rounded-lg w-full max-h-96 object-cover"/>
                  )}
                  <p className="mt-2 text-sm text-gray-400">Date: {new Date(item.createdAt || new Date()).toLocaleDateString()}</p>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center text-gray-500 py-10">No items found.</div>
          )}
        </div>
      );
    };

    const AdminPanel = () => (
      <div className="bg-white p-6 rounded-xl shadow-lg mt-8">
        <h2 className="text-2xl font-bold text-gray-800 mb-4">Admin Panel</h2>
        {pendingUsers.length > 0 ? (
          <div className="space-y-4">
            <h3 className="text-xl font-semibold text-gray-700">Pending Approvals</h3>
            {pendingUsers.map(userItem => (
              <div key={userItem.uid} className="flex items-center justify-between p-4 bg-yellow-50 border border-yellow-200 rounded-lg shadow-sm">
                <div>
                  <p className="text-lg font-medium text-gray-800">{userItem.name}</p>
                  <p className="text-sm text-gray-500">ID: {userItem.identificationNumber}</p>
                  <p className="text-sm text-gray-500 break-all">User UID: {userItem.uid}</p>
                  <a href={userItem.receiptUrl} target="_blank" rel="noopener noreferrer" className="text-sm text-blue-600 underline hover:no-underline">View Receipt</a>
                </div>
                <div className="flex space-x-2">
                  <button
                    onClick={() => approveUser(userItem.uid)}
                    className="px-4 py-2 bg-green-600 text-white rounded-lg shadow-md hover:bg-green-700 transition-colors"
                  >
                    Approve
                  </button>
                  <button
                    onClick={() => deleteUser(userItem.uid)}
                    className="px-4 py-2 bg-red-600 text-white rounded-lg shadow-md hover:bg-red-700 transition-colors"
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-gray-500 italic">No pending approvals.</p>
        )}
      </div>
    );

    return (
      <div className="min-h-screen bg-gray-100 p-8">
        <div className="flex space-x-4 mb-8">
          <div className="flex-1">
            <div className="bg-white p-6 rounded-xl shadow-lg text-center">
              <h3 className="text-xl font-semibold text-gray-800 mb-2">My Membership Status</h3>
              <p className="text-sm text-gray-600">ID: {userData?.identificationNumber || 'N/A'}</p>
              <div className={`mt-2 font-bold text-lg p-2 rounded-lg text-white ${userData?.status === 'active' ? 'bg-green-500' : userData?.status === 'pending' ? 'bg-yellow-500' : 'bg-red-500'}`}>
                Status: {userData?.status?.toUpperCase() || 'N/A'}
              </div>
            </div>
          </div>
        </div>

        <div className="flex flex-col lg:flex-row space-y-8 lg:space-y-0 lg:space-x-8">
          <div className="w-full lg:w-1/4">
            <nav className="bg-white p-6 rounded-xl shadow-lg space-y-4 sticky top-4">
              <h3 className="text-lg font-semibold text-gray-800 mb-2">Dashboard Sections</h3>
              <button
                onClick={() => setView('announcements')}
                className={`w-full py-3 px-4 rounded-lg text-left font-medium transition-colors ${view === 'announcements' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
              >
                Announcements
              </button>
              <button
                onClick={() => setView('activities')}
                className={`w-full py-3 px-4 rounded-lg text-left font-medium transition-colors ${view === 'activities' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
              >
                Activities
              </button>
              <button
                onClick={() => setView('gallery')}
                className={`w-full py-3 px-4 rounded-lg text-left font-medium transition-colors ${view === 'gallery' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
              >
                Photo Gallery
              </button>
            </nav>
          </div>
          <div className="w-full lg:w-3/4">
            {renderSection()}
          </div>
        </div>
        {isAdmin && <AdminPanel />}
      </div>
    );
  };

  // Main render logic based on user state
  let content;
  // If no user is logged in, show the login view unless guest mode is active
  if (!user && !isGuest) {
    content = <LoginView setIsGuest={setIsGuest} />;
  }
  // If user is logged in but not registered, show the signup form
  else if (user && !userData) {
    content = <SignupView />;
  }
  // Otherwise, show the dashboard (for registered users or guests)
  else {
    content = <DashboardView />;
  }

  return (
    <div className="font-sans antialiased text-gray-900 bg-gray-100 min-h-screen">
      <MessageBox message={message} type={messageType} />
      <Header />
      {userData?.status === 'expired' && <ExpiredBanner />}
      {content}
    </div>
  );
};

export default App;
