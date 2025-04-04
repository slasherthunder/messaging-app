'use client';
import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { auth, db } from '../lib/firebase';
import { useAuthState } from 'react-firebase-hooks/auth';
import { 
  doc, getDoc, updateDoc, collection, query, 
  where, getDocs, addDoc, serverTimestamp, 
  onSnapshot, orderBy 
} from 'firebase/firestore';
import { 
  updatePassword, reauthenticateWithCredential, 
  EmailAuthProvider, updateProfile 
} from 'firebase/auth';
import { 
  FiUser, FiMail, FiCalendar, FiLogOut, FiLock, 
  FiSearch, FiMessageSquare, FiSend, FiChevronLeft 
} from 'react-icons/fi';

export default function Dashboard() {
  const [user, loading, errorAuth] = useAuthState(auth);
  const [userData, setUserData] = useState(null);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [formData, setFormData] = useState({
    name: '',
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
    message: ''
  });
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [activeChat, setActiveChat] = useState(null);
  const [conversations, setConversations] = useState([]);
  const [messages, setMessages] = useState([]);
  const [unreadCounts, setUnreadCounts] = useState({});
  const messagesEndRef = useRef(null);
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) {
      router.push('/auth');
    }
    if (errorAuth) {
      console.error('Authentication error:', errorAuth);
      setError('Authentication error. Please try again.');
    }
  }, [user, loading, errorAuth, router]);

  useEffect(() => {
    const fetchUserData = async () => {
      if (user) {
        try {
          const docRef = doc(db, "users", user.uid);
          const docSnap = await getDoc(docRef);
          
          if (docSnap.exists()) {
            setUserData(docSnap.data());
            setFormData(prev => ({
              ...prev, 
              name: docSnap.data().name || user.email?.split('@')[0] || ''
            }));
            await updateDoc(docRef, {
              lastLogin: serverTimestamp()
            });
          } else {
            setUserData({
              name: user.displayName || user.email?.split('@')[0] || 'User',
              email: user.email,
              createdAt: new Date(),
              lastLogin: new Date()
            });
          }
        } catch (error) {
          console.error('Error fetching user data:', error);
          setError('Failed to load user data');
        }
      }
    };
    fetchUserData();
  }, [user]);

  useEffect(() => {
    if (!user) return;

    let unsubscribe;
    try {
      unsubscribe = onSnapshot(
        query(
          collection(db, "conversations"),
          where("participants", "array-contains", user.uid),
          orderBy("lastUpdated", "desc")
        ),
        (snapshot) => {
          const convos = [];
          const counts = {};
          snapshot.forEach(doc => {
            const data = doc.data();
            const otherUserId = data.participants.find(id => id !== user.uid);
            const unreadCount = data[`unread_${user.uid}`] || 0;
            
            convos.push({
              id: doc.id,
              otherUserId,
              lastMessage: data.lastMessage,
              lastUpdated: data.lastUpdated?.toDate(),
              unread: unreadCount
            });
            
            counts[doc.id] = unreadCount;
          });
          setConversations(convos);
          setUnreadCounts(counts);
        },
        (error) => {
          console.error("Conversations snapshot error:", error);
          if (error.code === 'failed-precondition') {
            setError('Query requires an index. Please try again in a moment.');
          } else {
            setError('Failed to load conversations');
          }
        }
      );
    } catch (error) {
      console.error("Error setting up conversations listener:", error);
      setError('Failed to setup conversations');
    }

    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, [user]);

  useEffect(() => {
    if (!activeChat || !user) return;

    let unsubscribe;
    try {
      unsubscribe = onSnapshot(
        query(
          collection(db, "conversations", activeChat.id, "messages"),
          orderBy("timestamp", "asc")
        ),
        (snapshot) => {
          const msgs = [];
          snapshot.forEach(doc => {
            msgs.push({
              id: doc.id,
              ...doc.data(),
              timestamp: doc.data().timestamp?.toDate()
            });
          });
          setMessages(msgs);
          markMessagesAsRead(msgs, activeChat.id);
        },
        (error) => {
          console.error("Messages snapshot error:", error);
          setError('Failed to load messages');
        }
      );
    } catch (error) {
      console.error("Error setting up messages listener:", error);
      setError('Failed to setup messages');
    }

    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, [activeChat, user]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const markMessagesAsRead = async (messages, conversationId) => {
    try {
      const unreadMessages = messages.filter(
        msg => msg.sender !== user?.uid && !msg.read
      );
      
      if (unreadMessages.length > 0) {
        const batch = [];
        unreadMessages.forEach(msg => {
          batch.push(updateDoc(
            doc(db, "conversations", conversationId, "messages", msg.id), 
            { read: true }
          ));
        });
        
        batch.push(updateDoc(
          doc(db, "conversations", conversationId), 
          { [`unread_${user?.uid}`]: 0 }
        ));
        
        await Promise.all(batch);
        
        setUnreadCounts(prev => ({
          ...prev,
          [conversationId]: 0
        }));
      }
    } catch (error) {
      console.error("Error marking messages as read:", error);
    }
  };

  const handleSearch = async (e) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;

    try {
      const usersRef = collection(db, "users");
      const q = query(
        usersRef,
        where("name", ">=", searchQuery),
        where("name", "<=", searchQuery + '\uf8ff')
      );
      const querySnapshot = await getDocs(q);
      const results = [];
      querySnapshot.forEach((doc) => {
        if (doc.id !== user?.uid) {
          results.push({ id: doc.id, ...doc.data() });
        }
      });
      setSearchResults(results);
      setError('');
    } catch (error) {
      console.error("Error searching users:", error);
      setError('Failed to search users');
    }
  };

  const startNewChat = async (otherUser) => {
    if (!user) return;
    
    setError('');
    try {
      const existingConvo = conversations.find(convo => 
        convo.otherUserId === otherUser.id
      );
      
      if (existingConvo) {
        setActiveChat({
          id: existingConvo.id,
          otherUser
        });
        return;
      }
      
      const docRef = await addDoc(collection(db, "conversations"), {
        participants: [user.uid, otherUser.id],
        lastMessage: "",
        lastUpdated: serverTimestamp(),
        [`unread_${user.uid}`]: 0,
        [`unread_${otherUser.id}`]: 0
      });
      
      setActiveChat({
        id: docRef.id,
        otherUser
      });
      setSuccess('New conversation started!');
      setTimeout(() => setSuccess(''), 3000);
    } catch (error) {
      console.error("Error creating conversation:", error);
      setError('Failed to start conversation');
    }
  };

  const sendMessage = async (e) => {
    e.preventDefault();
    if (!formData.message.trim() || !activeChat || !user) return;

    try {
      await addDoc(
        collection(db, "conversations", activeChat.id, "messages"), 
        {
          text: formData.message,
          sender: user.uid,
          timestamp: serverTimestamp(),
          read: false
        }
      );
      
      const conversationDoc = await getDoc(doc(db, "conversations", activeChat.id));
      const currentUnread = conversationDoc.data()?.[`unread_${activeChat.otherUser.id}`] || 0;
      
      await updateDoc(
        doc(db, "conversations", activeChat.id), 
        {
          lastMessage: formData.message,
          lastUpdated: serverTimestamp(),
          [`unread_${activeChat.otherUser.id}`]: currentUnread + 1
        }
      );
      
      setFormData(prev => ({...prev, message: ''}));
      setError('');
    } catch (error) {
      console.error("Error sending message:", error);
      setError('Failed to send message');
    }
  };

  const handleSignOut = async () => {
    try {
      await auth.signOut();
      router.push('/');
    } catch (error) {
      console.error('Sign out error:', error);
      setError('Failed to sign out');
    }
  };

  const handleProfileUpdate = async (e) => {
    e.preventDefault();
    if (!user) return;
    
    setError('');
    setSuccess('');
    
    try {
      const userRef = doc(db, "users", user.uid);
      await updateDoc(userRef, {
        name: formData.name,
        updatedAt: serverTimestamp()
      });
      
      await updateProfile(user, {
        displayName: formData.name
      });
      
      setUserData(prev => ({...prev, name: formData.name}));
      setSuccess('Profile updated successfully!');
      setTimeout(() => {
        setShowProfileModal(false);
        setSuccess('');
      }, 2000);
    } catch (error) {
      console.error('Update error:', error);
      setError('Failed to update profile. Please try again.');
    }
  };

  const handlePasswordChange = async (e) => {
    e.preventDefault();
    if (!user) return;
    
    setError('');
    setSuccess('');
    
    if (formData.newPassword !== formData.confirmPassword) {
      setError('New passwords do not match');
      return;
    }
    
    try {
      const credential = EmailAuthProvider.credential(
        user.email || '',
        formData.currentPassword
      );
      
      await reauthenticateWithCredential(user, credential);
      await updatePassword(user, formData.newPassword);
      
      setSuccess('Password changed successfully!');
      setTimeout(() => {
        setShowPasswordModal(false);
        setSuccess('');
        setFormData(prev => ({...prev, currentPassword: '', newPassword: '', confirmPassword: ''}));
      }, 2000);
    } catch (error) {
      console.error('Password change error:', error);
      if (error.code === 'auth/wrong-password') {
        setError('Current password is incorrect');
      } else if (error.code === 'auth/weak-password') {
        setError('Password should be at least 6 characters');
      } else {
        setError('Failed to change password. Please try again.');
      }
    }
  };

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({...prev, [name]: value}));
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-indigo-50 to-white">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-indigo-600"></div>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  return (
    <main className="min-h-screen bg-gradient-to-br from-indigo-50 to-white p-4 md:p-8">
      {showProfileModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
          <div className="bg-white p-6 rounded-xl max-w-md w-full shadow-2xl animate-fade-in">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-2xl font-bold text-indigo-900">Edit Profile</h2>
              <button 
                onClick={() => setShowProfileModal(false)}
                className="text-indigo-500 hover:text-indigo-700 transition-colors"
              >
                ✕
              </button>
            </div>
            <form onSubmit={handleProfileUpdate}>
              <div className="mb-6">
                <label className="block text-sm font-medium text-indigo-700 mb-2">Display Name</label>
                <input
                  type="text"
                  name="name"
                  value={formData.name}
                  onChange={handleInputChange}
                  className="w-full px-4 py-3 border border-indigo-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all"
                  required
                />
              </div>
              {error && (
                <div className="mb-4 p-3 bg-red-50 text-red-600 rounded-lg text-sm">
                  {error}
                </div>
              )}
              {success && (
                <div className="mb-4 p-3 bg-green-50 text-green-600 rounded-lg text-sm">
                  {success}
                </div>
              )}
              <div className="flex justify-end space-x-3">
                <button
                  type="button"
                  onClick={() => setShowProfileModal(false)}
                  className="px-5 py-2.5 bg-indigo-100 text-indigo-700 rounded-lg hover:bg-indigo-200 transition-colors font-medium"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors font-medium shadow-md hover:shadow-indigo-200"
                >
                  Save Changes
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showPasswordModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
          <div className="bg-white p-6 rounded-xl max-w-md w-full shadow-2xl animate-fade-in">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-2xl font-bold text-indigo-900">Change Password</h2>
              <button 
                onClick={() => {
                  setShowPasswordModal(false);
                  setError('');
                  setFormData(prev => ({...prev, currentPassword: '', newPassword: '', confirmPassword: ''}));
                }}
                className="text-indigo-500 hover:text-indigo-700 transition-colors"
              >
                ✕
              </button>
            </div>
            <form onSubmit={handlePasswordChange}>
              <div className="space-y-4 mb-6">
                <div>
                  <label className="block text-sm font-medium text-indigo-700 mb-2">Current Password</label>
                  <input
                    type="password"
                    name="currentPassword"
                    value={formData.currentPassword}
                    onChange={handleInputChange}
                    className="w-full px-4 py-3 border border-indigo-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-indigo-700 mb-2">New Password</label>
                  <input
                    type="password"
                    name="newPassword"
                    value={formData.newPassword}
                    onChange={handleInputChange}
                    className="w-full px-4 py-3 border border-indigo-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-indigo-700 mb-2">Confirm New Password</label>
                  <input
                    type="password"
                    name="confirmPassword"
                    value={formData.confirmPassword}
                    onChange={handleInputChange}
                    className="w-full px-4 py-3 border border-indigo-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all"
                    required
                  />
                </div>
              </div>
              {error && (
                <div className="mb-4 p-3 bg-red-50 text-red-600 rounded-lg text-sm">
                  {error}
                </div>
              )}
              {success && (
                <div className="mb-4 p-3 bg-green-50 text-green-600 rounded-lg text-sm">
                  {success}
                </div>
              )}
              <div className="flex justify-end space-x-3">
                <button
                  type="button"
                  onClick={() => {
                    setShowPasswordModal(false);
                    setError('');
                    setFormData(prev => ({...prev, currentPassword: '', newPassword: '', confirmPassword: ''}));
                  }}
                  className="px-5 py-2.5 bg-indigo-100 text-indigo-700 rounded-lg hover:bg-indigo-200 transition-colors font-medium"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors font-medium shadow-md hover:shadow-indigo-200"
                >
                  Change Password
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <div className="max-w-7xl mx-auto">
        {error && (
          <div className="mb-6 p-4 bg-red-50 border-l-4 border-red-500 text-red-700 rounded-lg shadow-sm">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <svg className="h-5 w-5 text-red-500" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                </svg>
              </div>
              <div className="ml-3">
                <p className="text-sm font-medium">{error}</p>
              </div>
            </div>
          </div>
        )}
        {success && (
          <div className="mb-6 p-4 bg-green-50 border-l-4 border-green-500 text-green-700 rounded-lg shadow-sm">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <svg className="h-5 w-5 text-green-500" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
              </div>
              <div className="ml-3">
                <p className="text-sm font-medium">{success}</p>
              </div>
            </div>
          </div>
        )}

        <div className="flex justify-between items-center mb-8">
          <h1 className="text-3xl font-bold text-indigo-900">
            {activeChat ? (
              <div className="flex items-center">
                <button 
                  onClick={() => setActiveChat(null)}
                  className="mr-4 p-2 rounded-full hover:bg-indigo-100 transition-colors"
                >
                  <FiChevronLeft className="text-2xl text-indigo-600" />
                </button>
                <span className="text-indigo-800">{activeChat.otherUser?.name || 'Unknown User'}</span>
              </div>
            ) : (
              <span className="bg-clip-text text-transparent bg-gradient-to-r from-indigo-600 to-purple-600">
                Welcome back, {userData?.name || 'User'}
              </span>
            )}
          </h1>
          <button
            onClick={handleSignOut}
            className="flex items-center px-4 py-2.5 bg-white text-red-600 rounded-lg hover:bg-red-50 transition-colors border border-red-100 shadow-sm"
          >
            <FiLogOut className="mr-2" /> Sign Out
          </button>
        </div>

        {activeChat ? (
          <div className="bg-white rounded-xl shadow-sm border border-indigo-100 overflow-hidden flex flex-col h-[calc(100vh-180px)]">
            <div className="flex-1 overflow-y-auto p-6 bg-indigo-50">
              {messages.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-indigo-400">
                  <FiMessageSquare className="text-4xl mb-4" />
                  <p className="text-lg">No messages yet</p>
                  <p className="text-sm mt-1">Send your first message to start the conversation</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {messages.map((message) => (
                    <div 
                      key={message.id} 
                      className={`flex ${message.sender === user?.uid ? 'justify-end' : 'justify-start'}`}
                    >
                      <div 
                        className={`max-w-xs md:max-w-md px-4 py-3 rounded-2xl ${message.sender === user?.uid 
                          ? 'bg-indigo-600 text-white rounded-br-none' 
                          : 'bg-white text-indigo-900 rounded-bl-none border border-indigo-200'}`}
                      >
                        <p className="text-sm md:text-base">{message.text}</p>
                        <div className={`flex items-center justify-end mt-1 space-x-1 ${message.sender === user?.uid ? 'text-indigo-200' : 'text-indigo-500'}`}>
                          <span className="text-xs">
                            {message.timestamp?.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                          </span>
                          {message.read && message.sender === user?.uid && (
                            <span className="text-xs">✓</span>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                  <div ref={messagesEndRef} />
                </div>
              )}
            </div>
            
            <form onSubmit={sendMessage} className="border-t border-indigo-200 p-4 bg-white">
              <div className="flex items-center">
                <input
                  type="text"
                  name="message"
                  value={formData.message}
                  onChange={handleInputChange}
                  placeholder="Type a message..."
                  className="flex-1 px-4 py-3 border border-indigo-300 rounded-l-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all"
                  autoComplete="off"
                />
                <button
                  type="submit"
                  disabled={!formData.message.trim()}
                  className={`px-5 py-3 rounded-r-lg transition-colors ${formData.message.trim() 
                    ? 'bg-indigo-600 text-white hover:bg-indigo-700' 
                    : 'bg-indigo-200 text-indigo-400 cursor-not-allowed'}`}
                >
                  <FiSend className="text-lg" />
                </button>
              </div>
            </form>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="bg-white p-6 rounded-xl shadow-sm border border-indigo-100">
              <div className="flex flex-col items-center mb-6">
                <div className="relative mb-4">
                  <div className="w-24 h-24 rounded-full bg-gradient-to-br from-indigo-100 to-purple-100 flex items-center justify-center text-indigo-600 text-3xl font-bold border-4 border-white shadow-md">
                    {userData?.name ? userData.name.charAt(0).toUpperCase() : user?.email?.charAt(0).toUpperCase() || 'U'}
                  </div>
                </div>
                <h2 className="text-xl font-bold text-indigo-900 text-center">
                  {userData?.name || user?.email?.split('@')[0] || 'User'}
                </h2>
                <p className="text-indigo-700 text-center text-sm mt-1">{user?.email || 'No email'}</p>
              </div>

              <div className="space-y-4">
                <div className="flex items-center text-indigo-800 p-3 bg-indigo-50 rounded-lg">
                  <div className="bg-indigo-100 p-2 rounded-lg mr-3">
                    <FiCalendar className="text-indigo-600" />
                  </div>
                  <div>
                    <p className="text-xs text-indigo-600">Member since</p>
                    <p className="text-sm font-medium">
                      {userData?.createdAt?.toDate?.()?.toLocaleDateString() || 'Unknown'}
                    </p>
                  </div>
                </div>
                <div className="flex items-center text-indigo-800 p-3 bg-indigo-50 rounded-lg">
                  <div className="bg-indigo-100 p-2 rounded-lg mr-3">
                    <FiCalendar className="text-indigo-600" />
                  </div>
                  <div>
                    <p className="text-xs text-indigo-600">Last login</p>
                    <p className="text-sm font-medium">
                      {userData?.lastLogin?.toDate?.()?.toLocaleString() || 'Just now'}
                    </p>
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-white p-6 rounded-xl shadow-sm border border-indigo-100 lg:col-span-2">
              <h2 className="text-xl font-bold text-indigo-900 mb-6">Find Users</h2>
              <form onSubmit={handleSearch} className="mb-6">
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <FiSearch className="text-indigo-400" />
                  </div>
                  <input
                    type="text"
                    placeholder="Search by name..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-10 pr-4 py-3 border border-indigo-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all"
                  />
                </div>
                <button
                  type="submit"
                  className="mt-3 px-5 py-2.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors font-medium shadow-md hover:shadow-indigo-200 w-full md:w-auto"
                >
                  Search Users
                </button>
              </form>

              {searchResults.length > 0 ? (
                <div className="space-y-4">
                  <h3 className="text-lg font-semibold text-indigo-800">Search Results</h3>
                  <div className="divide-y divide-indigo-100">
                    {searchResults.map((user) => (
                      <div key={user.id} className="py-4 flex items-center justify-between">
                        <div className="flex items-center">
                          <div className="w-12 h-12 rounded-full bg-gradient-to-br from-indigo-100 to-purple-100 flex items-center justify-center text-indigo-600 font-bold text-xl mr-4 shadow-sm">
                            {user.name ? user.name.charAt(0).toUpperCase() : 'U'}
                          </div>
                          <div>
                            <p className="font-medium text-indigo-900">{user.name || 'Unknown User'}</p>
                            <p className="text-sm text-indigo-700">{user.email || 'No email available'}</p>
                          </div>
                        </div>
                        <button 
                          onClick={() => startNewChat(user)}
                          className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors text-sm flex items-center shadow-sm hover:shadow-md"
                        >
                          <FiMessageSquare className="mr-2" /> Message
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              ) : searchQuery ? (
                <div className="text-center py-8">
                  <FiSearch className="mx-auto text-4xl text-indigo-300 mb-4" />
                  <p className="text-indigo-600">No users found matching your search.</p>
                </div>
              ) : (
                <div className="text-center py-8">
                  <FiSearch className="mx-auto text-4xl text-indigo-300 mb-4" />
                  <p className="text-indigo-600">Enter a name to search for other users.</p>
                </div>
              )}
            </div>

            <div className="bg-white p-6 rounded-xl shadow-sm border border-indigo-100 lg:col-span-3">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-xl font-bold text-indigo-900">Your Conversations</h2>
                <span className="text-sm text-indigo-600">
                  {conversations.length} {conversations.length === 1 ? 'conversation' : 'conversations'}
                </span>
              </div>
              {conversations.length > 0 ? (
                <div className="space-y-3">
                  {conversations.map((convo) => (
                    <div 
                      key={convo.id} 
                      onClick={() => setActiveChat({
                        id: convo.id,
                        otherUser: searchResults.find(u => u.id === convo.otherUserId) || { 
                          id: convo.otherUserId, 
                          name: 'Unknown User' 
                        }
                      })}
                      className="p-4 border border-indigo-100 rounded-lg hover:bg-indigo-50 cursor-pointer transition-colors flex justify-between items-center"
                    >
                      <div className="flex items-center">
                        <div className="w-12 h-12 rounded-full bg-gradient-to-br from-indigo-100 to-purple-100 flex items-center justify-center text-indigo-600 font-bold text-xl mr-4 shadow-sm">
                          {convo.otherUserId.charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <p className="font-medium text-indigo-900">
                            {searchResults.find(u => u.id === convo.otherUserId)?.name || 'Unknown User'}
                          </p>
                          <p className="text-sm text-indigo-700 truncate max-w-xs">
                            {convo.lastMessage || 'No messages yet'}
                          </p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-xs text-indigo-600 mb-1">
                          {convo.lastUpdated?.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                        </p>
                        {convo.unread > 0 && (
                          <span className="inline-flex items-center justify-center h-6 w-6 rounded-full bg-red-500 text-white text-xs font-medium">
                            {convo.unread}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8">
                  <FiMessageSquare className="mx-auto text-4xl text-indigo-300 mb-4" />
                  <p className="text-indigo-600">You don't have any conversations yet.</p>
                  <p className="text-sm text-indigo-500 mt-1">Search for users to start chatting!</p>
                </div>
              )}
            </div>

            <div className="bg-white p-6 rounded-xl shadow-sm border border-indigo-100">
              <h2 className="text-xl font-bold text-indigo-900 mb-6">Account Settings</h2>
              <div className="space-y-3">
                <button 
                  onClick={() => setShowProfileModal(true)}
                  className="w-full flex items-center justify-between px-4 py-3 bg-indigo-50 text-indigo-800 rounded-lg hover:bg-indigo-100 transition-colors border border-indigo-100"
                >
                  <div className="flex items-center">
                    <div className="bg-indigo-100 p-2 rounded-lg mr-3">
                      <FiUser className="text-indigo-600" />
                    </div>
                    <span className="font-medium">Edit Profile</span>
                  </div>
                  <span className="text-indigo-400">→</span>
                </button>
                <button 
                  onClick={() => setShowPasswordModal(true)}
                  className="w-full flex items-center justify-between px-4 py-3 bg-indigo-50 text-indigo-800 rounded-lg hover:bg-indigo-100 transition-colors border border-indigo-100"
                >
                  <div className="flex items-center">
                    <div className="bg-indigo-100 p-2 rounded-lg mr-3">
                      <FiLock className="text-indigo-600" />
                    </div>
                    <span className="font-medium">Change Password</span>
                  </div>
                  <span className="text-indigo-400">→</span>
                </button>
                <button 
                  className="w-full flex items-center justify-between px-4 py-3 bg-indigo-50 text-indigo-800 rounded-lg hover:bg-indigo-100 transition-colors border border-indigo-100"
                >
                  <div className="flex items-center">
                    <div className="bg-indigo-100 p-2 rounded-lg mr-3">
                      <FiMail className="text-indigo-600" />
                    </div>
                    <span className="font-medium">Email Preferences</span>
                  </div>
                  <span className="text-indigo-400">→</span>
                </button>
              </div>

              <div className="mt-8">
                <h3 className="text-sm font-medium text-indigo-600 uppercase tracking-wider mb-4">Account Status</h3>
                <div className="flex items-center justify-between bg-green-50 px-4 py-3 rounded-lg border border-green-100">
                  <div className="flex items-center">
                    <div className="bg-green-100 p-1.5 rounded-full mr-3">
                      <svg className="h-4 w-4 text-green-600" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                      </svg>
                    </div>
                    <span className="text-green-600 font-medium">Active</span>
                  </div>
                  <span className="text-xs bg-green-100 text-green-800 px-2.5 py-1 rounded-full font-medium">Verified</span>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}