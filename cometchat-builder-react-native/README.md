# CometChat UIKit Builder - React Native

<p align="center">
  <img alt="CometChat" src="https://assets.cometchat.io/website/images/logos/banner.png">
</p>

CometChat UIKit Builder is a powerful React Native application that allows you to quickly configure and customize your CometChat-powered app by scanning a QR code. The scanned QR code includes theme settings, UI configurations, feature toggles, and other app-level preferences that will automatically be applied to your app.

## ✨ Features

📱 **QR Code Scanning**: Easily scan QR codes to fetch and apply app configurations instantly  
🎨 **Dynamic Theme Customization**: Apply custom themes, colors, and typography styles in real-time  
🔧 **Feature Configuration**: Enable/disable chat features, calling capabilities, and UI components  
📋 **Layout Management**: Configure sidebar, tabs, and chat type preferences  
⚡ **Seamless Integration**: Works directly with CometChat's React Native UI Kit  
🔄 **Real-time Updates**: Instantly apply scanned configurations without app restart  
💾 **Persistent Settings**: Automatically save and restore configurations using AsyncStorage  

## 🛠 Requirements

- **Node.js** 18 or higher
- **React Native** 0.77 or later
- **iOS**: iOS 12.0+, Xcode 14+, CocoaPods
- **Android**: Android 5.0+, Android Studio

## 📦 Installation

### 1. Download the Code
Download the source code from the repository and extract it to your desired location.

### 2. Install Dependencies
```bash
cd uikit-builder-app-react-native
npm install
```

### 3. iOS Setup
```bash
cd ios
pod install
cd ..
```

### 4. Configure CometChat Credentials
Open `src/utils/AppConstants.tsx` and add your CometChat credentials:

```typescript
export const AppConstants = {
  appId: 'YOUR_APP_ID',
  authKey: 'YOUR_AUTH_KEY', 
  region: 'YOUR_REGION',
  // other properties...
}
```

### 5. Run the Application
```bash
# Start Metro bundler
npm start

# Run on iOS
npm run ios

# Run on Android  
npm run android
```

## 🚀 Integration in Your Existing React Native App

To integrate the UIKit Builder configuration system into your existing React Native app:

### 1. Install Required Dependencies
```bash
npm install zustand @react-native-async-storage/async-storage
```

### 2. Copy Configuration Files
Copy these two essential files from the downloaded code to your existing React Native project:

- `src/config/store.ts` - Configuration store management
- `src/config/config.json` - Default configuration template

Place them in your project at the same path: `yourProject/src/config/`

### 3. Import and Use Configuration Store

In your main App component, import the configuration store:

```typescript
import React from 'react';
import { CometChatThemeProvider } from '@cometchat/chat-uikit-react-native';
import { useConfig } from './src/config/store';

const App = () => {
  // Get theme configuration from store
  const styleConfig = useConfig(state => state.settings.style);
  
  // Create theme object based on configuration
  const theme = {
    light: {
      color: {
        primary: styleConfig.color.brandColor,
        textPrimary: styleConfig.color.primaryTextLight,
        textSecondary: styleConfig.color.secondaryTextLight,
      },
      // Apply typography and other settings
    },
    dark: {
      color: {
        primary: styleConfig.color.brandColor,
        textPrimary: styleConfig.color.primaryTextDark,
        textSecondary: styleConfig.color.secondaryTextDark,
      },
    },
  };

  return (
    <CometChatThemeProvider theme={theme}>
      {/* Your existing app components */}
    </CometChatThemeProvider>
  );
};
```

### 4. Access Feature Configurations

In your existing CometChat components, you can access and apply feature configurations from the store. The configuration will automatically control which features are enabled or disabled based on the settings in `config.json` or any scanned QR code data.

## 📁 Project Structure

```
src/
├── components/
│   ├── conversations/     # Chat and messaging components
│   ├── calls/            # Voice/video calling components  
│   ├── groups/           # Group management components
│   ├── users/            # User management components
│   └── login/            # Authentication components
├── config/
│   ├── store.ts          # Zustand store for configuration
│   └── config.json       # Default configuration template
├── navigation/           # App navigation setup
├── utils/               # Helper utilities and constants
└── assets/              # Icons and images
```

## ⚙️ Configuration Schema

The QR code should contain a JSON object with the following structure:

```json
{
  "builderId": "unique-builder-id",
  "settings": {
    "chatFeatures": {
      "coreMessagingExperience": {
        "typingIndicator": true,
        "threadConversationAndReplies": true,
        // ... other messaging features
      },
      "deeperUserEngagement": {
        "mentions": true,
        "reactions": true,
        // ... engagement features  
      }
    },
    "callFeatures": {
      "voiceAndVideoCalling": {
        "oneOnOneVoiceCalling": true,
        "groupVideoConference": true,
        // ... calling features
      }
    },
    "layout": {
      "withSideBar": true,
      "tabs": ["chats", "calls", "users", "groups"],
      "chatType": "both"
    },
    "style": {
      "theme": "system",
      "color": {
        "brandColor": "#6852D6",
        "primaryTextLight": "#141414",
        // ... color configuration
      },
      "typography": {
        "font": "roboto",
        "size": "default"
      }
    }
  }
}
```

## 🎯 Use Cases

- **App Customization**: Allow users to personalize their chat experience
- **Brand Consistency**: Apply company themes and colors instantly
- **Feature Testing**: Enable/disable features for A/B testing
- **Client Demos**: Quickly showcase different configurations to clients
- **Theme Marketplace**: Share and distribute custom themes via QR codes

## 📱 Sample QR Codes

You can generate QR codes containing configuration JSON to test different themes and features. Use any QR code generator with the JSON configuration as the content.

## 🔧 Advanced Configuration

### Custom Font Integration

1. Add your custom font files to:
   - iOS: `ios/YourApp/Resources/Fonts/`
   - Android: `android/app/src/main/assets/fonts/`

2. Update the font mapping in `App.tsx`:

```typescript
const FONT_MAP = {
  'your-custom-font': {
    regular: Platform.OS === 'ios' ? 'YourFont-Regular' : 'your_font_regular',
    medium: Platform.OS === 'ios' ? 'YourFont-Medium' : 'your_font_medium',
    bold: Platform.OS === 'ios' ? 'YourFont-Bold' : 'your_font_bold',
  }
};
```

### Persistent Configuration

The app automatically saves scanned configurations to AsyncStorage. To manually manage persistence:

```typescript
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useConfigStore } from './src/config/store';

// Save current config
const saveConfig = async () => {
  const config = useConfigStore.getState().config;
  await AsyncStorage.setItem('@app_config', JSON.stringify(config));
};

// Load saved config
const loadConfig = async () => {
  const savedConfig = await AsyncStorage.getItem('@app_config');
  if (savedConfig) {
    useConfigStore.getState().updateConfig(JSON.parse(savedConfig));
  }
};
```

## 📖 Help and Support

For issues running the project or integrating with our UI Kits:

- 📚 **Documentation**: [CometChat React Native UI Kit](https://www.cometchat.com/docs/ui-kit/react-native/5.0/getting-started)
- 🎫 **Support Tickets**: [Create a Support Ticket](https://help.cometchat.com/hc/en-us)
- 💬 **Real-time Support**: [CometChat Dashboard](http://app.cometchat.com/)
- 🐛 **Issues**: [GitHub Issues](https://github.com/cometchat-team/uikit-builder-app-react-native/issues)

## 📄 License

This project is licensed under the MIT License - see the LICENSE file for details.

---

⚡ **With CometChat UIKit Builder, give your users the power to instantly configure your app's theme, features, and settings just by scanning a QR code!**
