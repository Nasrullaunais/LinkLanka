import React, {useRef} from 'react';
import {CometChat} from '@cometchat/chat-sdk-react-native';
import {navigate, navigationRef} from '../../../navigation/NavigationService';
import {CometChatCalls} from '@cometchat/calls-sdk-react-native';
import {CometChatOngoingCall} from '@cometchat/chat-uikit-react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {SCREEN_CONSTANTS} from '../../../utils/AppConstants';

const OngoingCallScreen = ({navigation, route}: any) => {
  const {call} = route.params;
  const isAudioCall = call.callType === 'audio';
  let sessionID = call.sessionId;

  const callListener = useRef<any>(null);
  const callSettings = useRef<any>(null);

  callListener.current = new CometChatCalls.OngoingCallListener({
    onCallEnded: () => {
      CometChat.clearActiveCall();
      CometChatCalls.endSession();
      navigate('BottomTabNavigator');
      navigationRef.reset({
        index: 0,
        routes: [{name: SCREEN_CONSTANTS.BOTTOM_TAB_NAVIGATOR}],
      });
    },
    onCallEndButtonPressed: () => {
      CometChat.endCall((call as CometChat.Call).getSessionId());
      navigate('BottomTabNavigator');
      navigationRef.reset({
        index: 0,
        routes: [{name: SCREEN_CONSTANTS.BOTTOM_TAB_NAVIGATOR}],
      });
    },
  });

  callSettings.current = new CometChatCalls.CallSettingsBuilder()
    .enableDefaultLayout(true)
    .setCallEventListener(callListener.current)
    .setIsAudioOnlyCall(isAudioCall);

  return (
    <SafeAreaView
      style={{
        height: '100%',
        width: '100%',
        position: 'relative',
      }}>
      <CometChatOngoingCall
        sessionID={sessionID}
        callSettingsBuilder={callSettings.current}
      />
    </SafeAreaView>
  );
};

export default OngoingCallScreen;
