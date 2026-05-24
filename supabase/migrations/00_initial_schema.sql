-- Create custom types for Oil & Gas commodities and roles
CREATE TYPE public.user_role AS ENUM ('admin', 'analyst', 'trader', 'operator');
CREATE TYPE public.commodity_type AS ENUM ('crude_oil', 'natural_gas', 'lng', 'refined_products', 'npls');

-- PROFILES TABLE: Handles onboarding and role-based access
CREATE TABLE public.profiles (
  id uuid REFERENCES auth.users ON DELETE CASCADE NOT NULL PRIMARY KEY,
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()),
  full_name text,
  avatar_url text,
  role public.user_role DEFAULT 'analyst'::public.user_role,
  organization_name text,
  
  CONSTRAINT full_name_length CHECK (char_length(full_name) >= 3)
);

-- SIGNALS TABLE: The core feed for Track A
CREATE TABLE public.signals (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  provider_id uuid REFERENCES public.profiles(id),
  
  -- The raw payload from sensors or external APIs
  raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  
  -- Categorization and Analysis
  commodity_tags public.commodity_type[] DEFAULT '{}'::public.commodity_type[],
  confidence_score numeric(5, 4) NOT NULL DEFAULT 0.0000,
  
  -- Geographic or Asset context
  region text,
  asset_identifier text,
  
  -- Metadata for filtering
  is_verified boolean DEFAULT false,
  expires_at timestamp with time zone,

  CONSTRAINT confidence_range CHECK (confidence_score >= 0 AND confidence_score <= 1)
);

-- Set up Row Level Security (RLS)
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.signals ENABLE ROW LEVEL SECURITY;

-- Profiles Policies
CREATE POLICY "Public profiles are viewable by everyone." ON public.profiles
  FOR SELECT USING (true);

CREATE POLICY "Users can insert their own profile." ON public.profiles
  FOR INSERT WITH CHECK (auth.uid() = id);

CREATE POLICY "Users can update own profile." ON public.profiles
  FOR UPDATE USING (auth.uid() = id);

-- Signals Policies
CREATE POLICY "Signals are viewable by authenticated users." ON public.signals
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Only admins or specific roles can insert signals." ON public.signals
  FOR INSERT TO authenticated 
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles 
      WHERE id = auth.uid() AND (role = 'admin' OR role = 'operator')
    )
  );

-- Create a function to handle new user onboarding
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, avatar_url)
  VALUES (new.id, new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'avatar_url');
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger to create profile on signup
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Performance Indexes
CREATE INDEX idx_signals_commodity_tags ON public.signals USING GIN (commodity_tags);
CREATE INDEX idx_signals_confidence_score ON public.signals (confidence_score DESC);
CREATE INDEX idx_signals_created_at ON public.signals (created_at DESC);
