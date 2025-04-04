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

  // Redirect if not authenticated
  useEffect(() => {
    if (!loading && !user) {
      router.push('/auth');
    }
    if (errorAuth) {
      console.error('Authentication error:', errorAuth);
      setError('Authentication error. Please try again.');
    }
  }, [user, loading, errorAuth, router]);

  // Fetch user data
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
            // Initialize user data if document doesn't exist
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

  // Fetch conversations with error handling
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

  // Fetch messages for active chat with error handling
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
          
          // Mark messages as read
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

  // Auto-scroll to bottom of messages
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
        
        // Update local unread counts
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
      // Check if conversation already exists
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
      
      // Create new conversation
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
      // Add message to subcollection
      await addDoc(
        collection(db, "conversations", activeChat.id, "messages"), 
        {
          text: formData.message,
          sender: user.uid,
          timestamp: serverTimestamp(),
          read: false
        }
      );
      
      // Get current unread count for the recipient
      const conversationDoc = await getDoc(doc(db, "conversations", activeChat.id));
      const currentUnread = conversationDoc.data()?.[`unread_${activeChat.otherUser.id}`] || 0;
      
      // Update conversation last message and increment unread count
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
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-indigo-500"></div>
      </div>
    );
  }

  if (!user) {
    return null; // or redirect to auth page
  }

  return (
    <main className="min-h-screen bg-gray-50 p-4 md:p-8">
      {/* Profile Update Modal */}
      {showProfileModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white p-6 rounded-xl max-w-md w-full shadow-xl">
            <h2 className="text-xl font-semibold mb-4 text-black">Edit Profile</h2>
            <form onSubmit={handleProfileUpdate}>
              <div className="mb-4">
                <label className="block text-gray-700 mb-2">Name</label>
                <input
                  type="text"
                  name="name"
                  value={formData.name}
                  onChange={handleInputChange}
                  className="w-full px-3 py-2 border rounded-lg"
                  required
                />
              </div>
              {error && <p className="text-red-500 mb-4">{error}</p>}
              {success && <p className="text-green-500 mb-4">{success}</p>}
              <div className="flex justify-end space-x-3">
                <button
                  type="button"
                  onClick={() => setShowProfileModal(false)}
                  className="px-4 py-2 bg-gray-200 text-gray-800 rounded-lg hover:bg-gray-300 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors"
                >
                  Save Changes
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Password Change Modal */}
      {showPasswordModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white p-6 rounded-xl max-w-md w-full shadow-xl">
            <h2 className="text-xl font-semibold mb-4 text-black">Change Password</h2>
            <form onSubmit={handlePasswordChange}>
              <div className="mb-4">
                <label className="block text-gray-700 mb-2">Current Password</label>
                <input
                  type="password"
                  name="currentPassword"
                  value={formData.currentPassword}
                  onChange={handleInputChange}
                  className="w-full px-3 py-2 border rounded-lg"
                  required
                />
              </div>
              <div className="mb-4">
                <label className="block text-gray-700 mb-2">New Password</label>
                <input
                  type="password"
                  name="newPassword"
                  value={formData.newPassword}
                  onChange={handleInputChange}
                  className="w-full px-3 py-2 border rounded-lg"
                  required
                />
              </div>
              <div className="mb-4">
                <label className="block text-gray-700 mb-2">Confirm New Password</label>
                <input
                  type="password"
                  name="confirmPassword"
                  value={formData.confirmPassword}
                  onChange={handleInputChange}
                  className="w-full px-3 py-2 border rounded-lg"
                  required
                />
              </div>
              {error && <p className="text-red-500 mb-4">{error}</p>}
              {success && <p className="text-green-500 mb-4">{success}</p>}
              <div className="flex justify-end space-x-3">
                <button
                  type="button"
                  onClick={() => {
                    setShowPasswordModal(false);
                    setError('');
                    setFormData(prev => ({...prev, currentPassword: '', newPassword: '', confirmPassword: ''}));
                  }}
                  className="px-4 py-2 bg-gray-200 text-gray-800 rounded-lg hover:bg-gray-300 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors"
                >
                  Change Password
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <div className="max-w-6xl mx-auto">
        {/* Error/Success Messages */}
        {error && (
          <div className="mb-4 p-4 bg-red-100 text-red-700 rounded-lg">
            {error}
          </div>
        )}
        {success && (
          <div className="mb-4 p-4 bg-green-100 text-green-700 rounded-lg">
            {success}
          </div>
        )}

        <div className="flex justify-between items-center mb-8">
          <h1 className="text-3xl font-bold text-black">
            {activeChat ? (
              <div className="flex items-center">
                <button 
                  onClick={() => setActiveChat(null)}
                  className="mr-4 p-1 rounded-full hover:bg-gray-100"
                >
                  <FiChevronLeft className="text-2xl" />
                </button>
                <span>{activeChat.otherUser?.name || 'Unknown User'}</span>
              </div>
            ) : (
              'Dashboard'
            )}
          </h1>
          <button
            onClick={handleSignOut}
            className="flex items-center px-4 py-2 bg-red-100 text-red-700 rounded-lg hover:bg-red-200 transition-colors"
          >
            <FiLogOut className="mr-2" /> Sign Out
          </button>
        </div>

        {activeChat ? (
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
            {/* Messages area */}
            <div className="h-[60vh] overflow-y-auto p-4">
              {messages.length === 0 ? (
                <div className="h-full flex items-center justify-center text-gray-500">
                  No messages yet. Start the conversation!
                </div>
              ) : (
                <div className="space-y-4">
                  {messages.map((message) => (
                    <div 
                      key={message.id} 
                      className={`flex ${message.sender === user?.uid ? 'justify-end' : 'justify-start'}`}
                    >
                      <div 
                        className={`max-w-xs md:max-w-md px-4 py-2 rounded-lg ${message.sender === user?.uid 
                          ? 'bg-indigo-600 text-white rounded-br-none' 
                          : 'bg-gray-200 text-gray-800 rounded-bl-none'}`}
                      >
                        <p>{message.text}</p>
                        <p className={`text-xs mt-1 ${message.sender === user?.uid ? 'text-indigo-200' : 'text-gray-500'}`}>
                          {message.timestamp?.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                          {message.read && message.sender === user?.uid && ' ✓'}
                        </p>
                      </div>
                    </div>
                  ))}
                  <div ref={messagesEndRef} />
                </div>
              )}
            </div>
            
            {/* Message input */}
            <form onSubmit={sendMessage} className="border-t border-gray-200 p-4">
              <div className="flex items-center">
                <input
                  type="text"
                  name="message"
                  value={formData.message}
                  onChange={handleInputChange}
                  placeholder="Type a message..."
                  className="flex-1 px-4 py-2 border rounded-l-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
                <button
                  type="submit"
                  disabled={!formData.message.trim()}
                  className="px-4 py-2 bg-indigo-600 text-white rounded-r-lg hover:bg-indigo-700 transition-colors disabled:bg-indigo-300"
                >
                  <FiSend />
                </button>
              </div>
            </form>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Profile Card */}
            <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
              <div className="flex flex-col items-center mb-6">
                <div className="relative mb-4">
                  <div className="w-24 h-24 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-600 text-2xl font-bold border-4 border-indigo-200">
                    {userData?.name ? userData.name.charAt(0).toUpperCase() : user?.email?.charAt(0).toUpperCase() || 'U'}
                  </div>
                </div>
                <h2 className="text-xl font-semibold text-black text-center">
                  {userData?.name || user?.email?.split('@')[0] || 'User'}
                </h2>
                <p className="text-gray-600 text-center">{user?.email || 'No email'}</p>
              </div>

              <div className="space-y-4">
                <div className="flex items-center text-gray-600">
                  <FiCalendar className="mr-3 text-indigo-600" />
                  <span>Member since: {userData?.createdAt?.toDate?.()?.toLocaleDateString() || 'Unknown'}</span>
                </div>
                <div className="flex items-center text-gray-600">
                  <FiCalendar className="mr-3 text-indigo-600" />
                  <span>Last login: {userData?.lastLogin?.toDate?.()?.toLocaleString() || 'Just now'}</span>
                </div>
              </div>
            </div>

            {/* Search Users Card */}
            <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200 lg:col-span-2">
              <h2 className="text-xl font-semibold mb-6 text-black">Find Users</h2>
              <form onSubmit={handleSearch} className="mb-6">
                <div className="relative">
                  <input
                    type="text"
                    placeholder="Search by name..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full px-4 py-2 pl-10 border rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                  <FiSearch className="absolute left-3 top-3 text-gray-400" />
                </div>
                <button
                  type="submit"
                  className="mt-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors"
                >
                  Search
                </button>
              </form>

              {searchResults.length > 0 ? (
                <div className="space-y-4">
                  <h3 className="text-lg font-medium text-gray-800">Search Results</h3>
                  <div className="divide-y divide-gray-200">
                    {searchResults.map((user) => (
                      <div key={user.id} className="py-3 flex items-center justify-between">
                        <div className="flex items-center">
                          <div className="w-10 h-10 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-600 font-bold mr-3">
                            {user.name ? user.name.charAt(0).toUpperCase() : 'U'}
                          </div>
                          <div>
                            <p className="font-medium text-gray-900">{user.name || 'Unknown User'}</p>
                            <p className="text-sm text-gray-500">{user.email || 'No email available'}</p>
                          </div>
                        </div>
                        <button 
                          onClick={() => startNewChat(user)}
                          className="px-3 py-1 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors text-sm flex items-center"
                        >
                          <FiMessageSquare className="mr-1" /> Message
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              ) : searchQuery ? (
                <p className="text-gray-500">No users found matching your search.</p>
              ) : (
                <p className="text-gray-500">Enter a name to search for other users.</p>
              )}
            </div>

            {/* Conversations Card */}
            <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200 lg:col-span-3">
              <h2 className="text-xl font-semibold mb-6 text-black">Your Conversations</h2>
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
                      className="p-3 border rounded-lg hover:bg-gray-50 cursor-pointer flex justify-between items-center"
                    >
                      <div className="flex items-center">
                        <div className="w-10 h-10 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-600 font-bold mr-3">
                          {convo.otherUserId.charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <p className="font-medium">
                            {searchResults.find(u => u.id === convo.otherUserId)?.name || 'Unknown User'}
                          </p>
                          <p className="text-sm text-gray-500 truncate max-w-xs">
                            {convo.lastMessage || 'No messages yet'}
                          </p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-xs text-gray-500">
                          {convo.lastUpdated?.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                        </p>
                        {convo.unread > 0 && (
                          <span className="inline-block mt-1 bg-red-500 text-white text-xs px-2 py-1 rounded-full">
                            {convo.unread}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-gray-500">You don't have any conversations yet. Search for users to start chatting!</p>
              )}
            </div>

            {/* Account Settings Card */}
            <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
              <h2 className="text-xl font-semibold mb-6 text-black">Account Settings</h2>
              <div className="space-y-4">
                <button 
                  onClick={() => setShowProfileModal(true)}
                  className="w-full flex items-center justify-between px-4 py-3 bg-gray-100 text-black rounded-lg hover:bg-gray-200 transition-colors"
                >
                  <div className="flex items-center">
                    <FiUser className="mr-3 text-indigo-600" />
                    <span>Edit Profile</span>
                  </div>
                  <span className="text-gray-500">→</span>
                </button>
                <button 
                  onClick={() => setShowPasswordModal(true)}
                  className="w-full flex items-center justify-between px-4 py-3 bg-gray-100 text-black rounded-lg hover:bg-gray-200 transition-colors"
                >
                  <div className="flex items-center">
                    <FiLock className="mr-3 text-indigo-600" />
                    <span>Change Password</span>
                  </div>
                  <span className="text-gray-500">→</span>
                </button>
                <button 
                  className="w-full flex items-center justify-between px-4 py-3 bg-gray-100 text-black rounded-lg hover:bg-gray-200 transition-colors"
                >
                  <div className="flex items-center">
                    <FiMail className="mr-3 text-indigo-600" />
                    <span>Email Preferences</span>
                  </div>
                  <span className="text-gray-500">→</span>
                </button>
              </div>

              <div className="mt-8">
                <h3 className="text-sm font-medium text-gray-500 mb-2">Account Status</h3>
                <div className="flex items-center justify-between bg-green-50 px-4 py-3 rounded-lg">
                  <span className="text-green-600 font-medium">Active</span>
                  <span className="text-xs bg-green-100 text-green-800 px-2 py-1 rounded-full">Verified</span>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}