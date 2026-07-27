jest.mock('@expo/vector-icons', () => {
  const React = require('react');
  const { Text } = require('react-native');
  const actual = jest.requireActual('@expo/vector-icons');

  function mockIcon(IconComponent) {
    function MockIcon({ name, ...props }) {
      return React.createElement(Text, props, name);
    }

    MockIcon.glyphMap = IconComponent.glyphMap;
    return MockIcon;
  }

  return {
    ...actual,
    Feather: mockIcon(actual.Feather),
    Ionicons: mockIcon(actual.Ionicons),
  };
});
