import 'react-native-reanimated';
import 'react-native-worklets-core'; // <-- INJECT JSI BINDINGS HERE
import { AppRegistry } from 'react-native';
import App from './App';
import { name as appName } from './app.json';

AppRegistry.registerComponent(appName, () => App);