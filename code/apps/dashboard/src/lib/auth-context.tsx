// ============================================================================
// Auth Context — Cognito authentication provider
// ============================================================================

'use client';

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from 'react';
import {
  CognitoUserPool,
  CognitoUser,
  AuthenticationDetails,
  CognitoUserSession,
  CognitoUserAttribute,
} from 'amazon-cognito-identity-js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AuthUser {
  username: string;
  email: string;
  accessToken: string;
  idToken: string;
  refreshToken: string;
}

interface AuthContextType {
  user: AuthUser | null;
  isLoading: boolean;
  error: string | null;
  signIn: (username: string, password: string) => Promise<void>;
  signOut: () => void;
  signUp: (username: string, password: string, email: string) => Promise<void>;
  clearError: () => void;
}

// ---------------------------------------------------------------------------
// Cognito configuration
// ---------------------------------------------------------------------------

const COGNITO_USER_POOL_ID = process.env['NEXT_PUBLIC_COGNITO_USER_POOL_ID'] ?? '';
const COGNITO_CLIENT_ID = process.env['NEXT_PUBLIC_COGNITO_CLIENT_ID'] ?? '';

const userPool = new CognitoUserPool({
  UserPoolId: COGNITO_USER_POOL_ID,
  ClientId: COGNITO_CLIENT_ID,
});

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

interface AuthProviderProps {
  children: ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Check for existing session on mount
  useEffect(() => {
    const cognitoUser = userPool.getCurrentUser();
    if (cognitoUser) {
      cognitoUser.getSession((err: Error | null, session: CognitoUserSession | null) => {
        if (err || !session) {
          setUser(null);
          setIsLoading(false);
          return;
        }

        if (session.isValid()) {
          const accessToken = session.getAccessToken().getJwtToken();
          const idToken = session.getIdToken().getJwtToken();
          const refreshToken = session.getRefreshToken().getToken();

          cognitoUser.getUserAttributes((err, attributes) => {
            if (err) {
              setUser(null);
              setIsLoading(false);
              return;
            }

            const emailAttr = attributes?.find((attr) => attr.getName() === 'email');
            const email = emailAttr?.getValue() ?? '';

            setUser({
              username: cognitoUser.getUsername() ?? '',
              email,
              accessToken,
              idToken,
              refreshToken,
            });
            setIsLoading(false);
          });
        } else {
          setUser(null);
          setIsLoading(false);
        }
      });
    } else {
      setIsLoading(false);
    }
  }, []);

  const signIn = useCallback(async (username: string, password: string) => {
    setIsLoading(true);
    setError(null);

    const authenticationDetails = new AuthenticationDetails({
      Username: username,
      Password: password,
    });

    const cognitoUser = new CognitoUser({
      Username: username,
      Pool: userPool,
    });

    return new Promise<void>((resolve, reject) => {
      cognitoUser.authenticateUser(authenticationDetails, {
        onSuccess: (session: CognitoUserSession) => {
          const accessToken = session.getAccessToken().getJwtToken();
          const idToken = session.getIdToken().getJwtToken();
          const refreshToken = session.getRefreshToken().getToken();

          cognitoUser.getUserAttributes((err, attributes) => {
            if (err) {
              setError(err.message);
              setIsLoading(false);
              reject(err);
              return;
            }

            const emailAttr = attributes?.find((attr) => attr.getName() === 'email');
            const email = emailAttr?.getValue() ?? '';

            setUser({
              username,
              email,
              accessToken,
              idToken,
              refreshToken,
            });
            setIsLoading(false);
            resolve();
          });
        },
        onFailure: (err: Error) => {
          setError(err.message);
          setIsLoading(false);
          reject(err);
        },
        newPasswordRequired: () => {
          setError('New password required. Please contact admin.');
          setIsLoading(false);
          reject(new Error('New password required'));
        },
      });
    });
  }, []);

  const signOut = useCallback(() => {
    const cognitoUser = userPool.getCurrentUser();
    if (cognitoUser) {
      cognitoUser.signOut();
    }
    setUser(null);
  }, []);

  const signUp = useCallback(async (username: string, password: string, email: string) => {
    setIsLoading(true);
    setError(null);

    const attributeList = [
      new CognitoUserAttribute({
        Name: 'email',
        Value: email,
      }),
    ];

    return new Promise<void>((resolve, reject) => {
      userPool.signUp(username, password, attributeList, [], (err, result) => {
        if (err) {
          setError(err.message);
          setIsLoading(false);
          reject(err);
          return;
        }

        if (result) {
          setError('Account created! Please check your email to verify your account, then sign in.');
        }
        setIsLoading(false);
        resolve();
      });
    });
  }, []);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        error,
        signIn,
        signOut,
        signUp,
        clearError,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
