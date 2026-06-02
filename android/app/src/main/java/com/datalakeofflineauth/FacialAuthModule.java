package com.datalakeofflineauth;

import android.content.res.AssetFileDescriptor;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;

import androidx.annotation.Nullable;

import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.WritableArray;

import org.tensorflow.lite.DataType;
import org.tensorflow.lite.Interpreter;
import org.tensorflow.lite.Tensor;

import java.io.FileInputStream;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.MappedByteBuffer;
import java.nio.channels.FileChannel;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class FacialAuthModule extends ReactContextBaseJavaModule {
  private static final String MODULE_NAME = "FacialAuth";
  private static final String MODEL_ASSET_PATH = "models/mobilefacenet_uint8.tflite";
  private static final float IMAGE_MEAN = 127.5f;
  private static final float IMAGE_STD = 128.0f;

  private final ExecutorService executor =
      Executors.newSingleThreadExecutor(
          runnable -> {
            Thread thread = new Thread(runnable, "FacialAuthExecutor");
            thread.setDaemon(true);
            return thread;
          });
  private final Object interpreterLock = new Object();

  @Nullable private final Interpreter interpreter;
  @Nullable private final Exception initException;

  private final int inputWidth;
  private final int inputHeight;
  private final int inputChannels;
  private final boolean inputIsNchw;
  private final DataType inputType;
  private final float inputScale;
  private final int inputZeroPoint;
  private final float inputScaleInv;

  private final DataType outputType;
  private final float outputScale;
  private final int outputZeroPoint;
  private final int outputElementCount;

  private final int[] pixelBuffer;
  private final ByteBuffer inputBuffer;
  @Nullable private final ByteBuffer outputBuffer;
  private final float[] embedding;
  @Nullable private final float[][] floatOutput;

  public FacialAuthModule(ReactApplicationContext reactContext) {
    super(reactContext);

    Interpreter localInterpreter = null;
    Exception localInitException = null;

    int localInputWidth = 112;
    int localInputHeight = 112;
    int localInputChannels = 3;
    boolean localInputIsNchw = false;
    DataType localInputType = DataType.INT8;
    float localInputScale = 1.0f;
    int localInputZeroPoint = 0;

    DataType localOutputType = DataType.INT8;
    float localOutputScale = 1.0f;
    int localOutputZeroPoint = 0;
    int localOutputElementCount = 192;

    try {
      MappedByteBuffer modelBuffer = loadModelFile(reactContext);
      Interpreter.Options options = new Interpreter.Options();
      int availableProcessors = Runtime.getRuntime().availableProcessors();
      int threads = Math.max(2, Math.min(4, availableProcessors));
      options.setNumThreads(threads);
      localInterpreter = new Interpreter(modelBuffer, options);

      Tensor inputTensor = localInterpreter.getInputTensor(0);
      int[] inputShape = inputTensor.shape();
      localInputType = inputTensor.dataType();
      Tensor.QuantizationParams inputQuant = inputTensor.quantizationParams();
      localInputScale = inputQuant.getScale();
      localInputZeroPoint = inputQuant.getZeroPoint();

      if (inputShape.length == 4) {
        if (inputShape[1] == 3) {
          localInputIsNchw = true;
          localInputChannels = inputShape[1];
          localInputHeight = inputShape[2];
          localInputWidth = inputShape[3];
        } else {
          localInputIsNchw = false;
          localInputHeight = inputShape[1];
          localInputWidth = inputShape[2];
          localInputChannels = inputShape[3];
        }
      }

      Tensor outputTensor = localInterpreter.getOutputTensor(0);
      localOutputType = outputTensor.dataType();
      Tensor.QuantizationParams outputQuant = outputTensor.quantizationParams();
      localOutputScale = outputQuant.getScale();
      localOutputZeroPoint = outputQuant.getZeroPoint();
      int[] outputShape = outputTensor.shape();
      localOutputElementCount = 1;
      for (int i = 1; i < outputShape.length; i++) {
        localOutputElementCount *= outputShape[i];
      }
    } catch (Exception e) {
      localInitException = e;
    }

    interpreter = localInterpreter;
    initException = localInitException;

    inputWidth = localInputWidth;
    inputHeight = localInputHeight;
    inputChannels = localInputChannels;
    inputIsNchw = localInputIsNchw;
    inputType = localInputType;
    inputScale = localInputScale == 0.0f ? 1.0f : localInputScale;
    inputZeroPoint = localInputZeroPoint;
    inputScaleInv = 1.0f / inputScale;

    outputType = localOutputType;
    outputScale = localOutputScale == 0.0f ? 1.0f : localOutputScale;
    outputZeroPoint = localOutputZeroPoint;
    outputElementCount = localOutputElementCount;

    int inputElementCount = inputWidth * inputHeight * inputChannels;
    int inputByteCount = inputType == DataType.FLOAT32 ? inputElementCount * 4 : inputElementCount;
    inputBuffer = ByteBuffer.allocateDirect(inputByteCount).order(ByteOrder.nativeOrder());
    pixelBuffer = new int[inputWidth * inputHeight];

    if (outputType == DataType.FLOAT32) {
      floatOutput = new float[1][outputElementCount];
      embedding = floatOutput[0];
      outputBuffer = null;
    } else {
      floatOutput = null;
      embedding = new float[outputElementCount];
      outputBuffer = ByteBuffer.allocateDirect(outputElementCount).order(ByteOrder.nativeOrder());
    }
  }

  @Override
  public String getName() {
    return MODULE_NAME;
  }

  @ReactMethod
  public void verifyFace(String imagePath, Promise promise) {
    if (imagePath == null || imagePath.trim().isEmpty()) {
      promise.reject("E_INVALID_PATH", "imagePath is null or empty.");
      return;
    }
    if (initException != null || interpreter == null) {
      promise.reject("E_TFLITE_INIT", "Failed to initialize TFLite interpreter.", initException);
      return;
    }

    final String normalizedPath = normalizePath(imagePath);
    executor.execute(
        () -> {
          try {
            float[] result = runInference(normalizedPath);
            WritableArray array = Arguments.createArray();
            for (float value : result) {
              array.pushDouble(value);
            }
            promise.resolve(array);
          } catch (Exception e) {
            promise.reject("E_TFLITE_INFER", "Face verification failed.", e);
          }
        });
  }

  @Override
  public void onCatalystInstanceDestroy() {
    executor.shutdown();
    if (interpreter != null) {
      interpreter.close();
    }
  }

  private float[] runInference(String imagePath) throws IOException {
    Bitmap bitmap = decodeAndResize(imagePath);
    try {
      fillInputBuffer(bitmap);
      if (outputType == DataType.FLOAT32) {
        synchronized (interpreterLock) {
          interpreter.run(inputBuffer, floatOutput);
        }
      } else {
        outputBuffer.rewind();
        synchronized (interpreterLock) {
          interpreter.run(inputBuffer, outputBuffer);
        }
        dequantizeOutput();
      }
      l2Normalize(embedding);
      return embedding;
    } finally {
      if (bitmap != null && !bitmap.isRecycled()) { // ADDED SAFETY CHECK
          bitmap.recycle();
      }
    }
  }

  private void fillInputBuffer(Bitmap bitmap) {
    inputBuffer.rewind();
    bitmap.getPixels(pixelBuffer, 0, inputWidth, 0, 0, inputWidth, inputHeight);

    if (inputIsNchw) {
      writeNchw();
    } else {
      writeNhwc();
    }
  }

  private void writeNhwc() {
    if (inputType == DataType.FLOAT32) {
      for (int pixel : pixelBuffer) {
        float r = ((pixel >> 16) & 0xFF);
        float g = ((pixel >> 8) & 0xFF);
        float b = (pixel & 0xFF);
        inputBuffer.putFloat(normalize(r));
        inputBuffer.putFloat(normalize(g));
        inputBuffer.putFloat(normalize(b));
      }
    } else if (inputType == DataType.INT8) {
      for (int pixel : pixelBuffer) {
        int r = (pixel >> 16) & 0xFF;
        int g = (pixel >> 8) & 0xFF;
        int b = pixel & 0xFF;
        inputBuffer.put(quantizeInt8(normalize(r)));
        inputBuffer.put(quantizeInt8(normalize(g)));
        inputBuffer.put(quantizeInt8(normalize(b)));
      }
    } else if (inputType == DataType.UINT8) {
      for (int pixel : pixelBuffer) {
        int r = (pixel >> 16) & 0xFF;
        int g = (pixel >> 8) & 0xFF;
        int b = pixel & 0xFF;
        inputBuffer.put(quantizeUint8(normalize(r)));
        inputBuffer.put(quantizeUint8(normalize(g)));
        inputBuffer.put(quantizeUint8(normalize(b)));
      }
    }
  }

  private void writeNchw() {
    if (inputType == DataType.FLOAT32) {
      for (int channel = 0; channel < 3; channel++) {
        for (int pixel : pixelBuffer) {
          float value = extractChannel(pixel, channel);
          inputBuffer.putFloat(normalize(value));
        }
      }
    } else if (inputType == DataType.INT8) {
      for (int channel = 0; channel < 3; channel++) {
        for (int pixel : pixelBuffer) {
          float value = extractChannel(pixel, channel);
          inputBuffer.put(quantizeInt8(normalize(value)));
        }
      }
    } else if (inputType == DataType.UINT8) {
      for (int channel = 0; channel < 3; channel++) {
        for (int pixel : pixelBuffer) {
          float value = extractChannel(pixel, channel);
          inputBuffer.put(quantizeUint8(normalize(value)));
        }
      }
    }
  }

  private float extractChannel(int pixel, int channel) {
    if (channel == 0) {
      return (pixel >> 16) & 0xFF;
    }
    if (channel == 1) {
      return (pixel >> 8) & 0xFF;
    }
    return pixel & 0xFF;
  }

  private float normalize(float value) {
    return (value - IMAGE_MEAN) / IMAGE_STD;
  }

  private byte quantizeInt8(float value) {
    int quantized = Math.round(value * inputScaleInv) + inputZeroPoint;
    if (quantized > 127) {
      quantized = 127;
    } else if (quantized < -128) {
      quantized = -128;
    }
    return (byte) quantized;
  }

  private byte quantizeUint8(float value) {
    int quantized = Math.round(value * inputScaleInv) + inputZeroPoint;
    if (quantized > 255) {
      quantized = 255;
    } else if (quantized < 0) {
      quantized = 0;
    }
    return (byte) quantized;
  }

  private void dequantizeOutput() {
    outputBuffer.rewind();
    for (int i = 0; i < outputElementCount; i++) {
      int quantized = outputBuffer.get();
      embedding[i] = (quantized - outputZeroPoint) * outputScale;
    }
  }

  private void l2Normalize(float[] vector) {
    float sum = 0.0f;
    for (float value : vector) {
      sum += value * value;
    }
    float inv = 1.0f / (float) Math.sqrt(sum + 1.0e-10f);
    for (int i = 0; i < vector.length; i++) {
      vector[i] *= inv;
    }
  }

  private Bitmap decodeAndResize(String imagePath) throws IOException {
    BitmapFactory.Options bounds = new BitmapFactory.Options();
    bounds.inJustDecodeBounds = true;
    BitmapFactory.decodeFile(imagePath, bounds);
    if (bounds.outWidth <= 0 || bounds.outHeight <= 0) {
      throw new IOException("Unable to decode image bounds.");
    }

    BitmapFactory.Options options = new BitmapFactory.Options();
    options.inPreferredConfig = Bitmap.Config.ARGB_8888;
    options.inDither = false;
    options.inScaled = false;
    options.inSampleSize = calculateInSampleSize(bounds.outWidth, bounds.outHeight, inputWidth, inputHeight);

    Bitmap decoded = BitmapFactory.decodeFile(imagePath, options);
    if (decoded == null) {
      throw new IOException("Unable to decode image.");
    }

    if (decoded.getWidth() == inputWidth && decoded.getHeight() == inputHeight) {
      return decoded;
    }

    Bitmap resized = Bitmap.createScaledBitmap(decoded, inputWidth, inputHeight, true);
    if (resized != decoded) {
      decoded.recycle();
    }
    return resized;
  }

  private int calculateInSampleSize(int width, int height, int reqWidth, int reqHeight) {
    int inSampleSize = 1;
    if (height > reqHeight || width > reqWidth) {
      int halfHeight = height / 2;
      int halfWidth = width / 2;
      while ((halfHeight / inSampleSize) >= reqHeight
          && (halfWidth / inSampleSize) >= reqWidth) {
        inSampleSize *= 2;
      }
    }
    return inSampleSize;
  }

  private String normalizePath(String imagePath) {
    if (imagePath.startsWith("file://")) {
      return imagePath.substring("file://".length());
    }
    return imagePath;
  }

  private MappedByteBuffer loadModelFile(ReactApplicationContext context) throws IOException {
    try (AssetFileDescriptor afd = context.getAssets().openFd(MODEL_ASSET_PATH);
        FileInputStream inputStream = new FileInputStream(afd.getFileDescriptor());
        FileChannel fileChannel = inputStream.getChannel()) {
      return fileChannel.map(
          FileChannel.MapMode.READ_ONLY, afd.getStartOffset(), afd.getDeclaredLength());
    }
  }
}
