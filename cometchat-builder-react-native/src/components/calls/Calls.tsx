import {CometChatCallLogs, useTheme} from '@cometchat/chat-uikit-react-native';
import {useFocusEffect, useNavigation} from '@react-navigation/native';
import React, {useCallback} from 'react';
import {View} from 'react-native';
import {StackNavigationProp} from '@react-navigation/stack';
import {RootStackParamList} from '../../navigation/types';

type CallNavigationProp = StackNavigationProp<RootStackParamList, 'CallLogs'>;

const Calls: React.FC = () => {
  const [shouldHide, setShouldHide] = React.useState(false);
  const navigation = useNavigation<CallNavigationProp>();

  useFocusEffect(
    useCallback(() => {
      setShouldHide(false);
      return () => {
        setShouldHide(true);
      };
    }, []),
  );

  const theme = useTheme();
  const onItemPress = (item: any) => {
    navigation.navigate('CallDetails', {
      call: item,
    });
  };
  return (
    <View style={{flex: 1, backgroundColor: theme.color.background1}}>
      {!shouldHide && <CometChatCallLogs onItemPress={onItemPress} />}
    </View>
  );
};

export default Calls;
